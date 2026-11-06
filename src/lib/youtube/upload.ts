/**
 * Upload a finished video to the workspace's YouTube channel (E-VID-03).
 *
 * YouTube's resumable upload (developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):
 * POST the metadata to `/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
 * with X-Upload-Content-Length/-Type → a session address in `Location`; then PUT the
 * bytes in pieces with `Content-Range: bytes a-b/total`. 308 means "keep going" and its
 * `Range` says how much YouTube holds (it may be less than was sent); 200/201 carries
 * the video resource. `Content-Range: bytes * /total` asks where things stand. Pieces
 * are multiples of 256 KiB except the last — 8 MiB here, as for Drive.
 *
 * Through the channel's own OAuth (`youtube.upload`, already in YOUTUBE_SCOPES).
 * ⚠ YouTube keeps uploads from an UNAUDITED Cloud project private, whatever
 * privacy is asked for, until the project passes its API audit — the form says so.
 * ⚠ Captions need the `youtube.force-ssl` scope, which isn't granted; the SRT is
 * offered to download instead. A custom thumbnail needs a verified channel —
 * YouTube's refusal is kept as the upload's note, not a failure.
 *
 * `YOUTUBE_UPLOAD_BASE_URL` points the calls at a stand-in for tests.
 */

export const YT_UPLOAD = (process.env.YOUTUBE_UPLOAD_BASE_URL || "https://www.googleapis.com/upload/youtube/v3").replace(/\/+$/, "");
export const YT_CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB
export const YT_MAX_BYTES = 4 * 1024 * 1024 * 1024; // what this app will move in one upload
export const YT_THUMB_MAX = 2 * 1024 * 1024; // YouTube's limit for a custom thumbnail

export type Privacy = "private" | "unlisted" | "public";
export type UploadMeta = {
  title: string;
  description: string;
  tags: string[];
  privacy: Privacy;
  /** A scheduled publish: the video stays private until then (YouTube requires private). */
  publishAt: Date | null;
  madeForKids: boolean;
};

export class UploadGone extends Error {}
export class UploadBusy extends Error {}

/** What YouTube would refuse, said before anything is sent. Null when fine. */
export function metadataProblem(m: UploadMeta, now = Date.now()): string | null {
  const title = m.title.trim();
  if (!title) return "A YouTube video needs a title.";
  if (title.length > 100) return `The title is ${title.length} characters — YouTube allows 100.`;
  if (/[<>]/.test(title) || /[<>]/.test(m.description)) return "YouTube refuses < and > in a title or description.";
  if (Buffer.byteLength(m.description, "utf8") > 5000) return "The description is over YouTube's 5,000-byte limit.";
  const tagChars = m.tags.reduce((a, t) => a + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, m.tags.length - 1);
  if (tagChars > 500) return "The tags come to more than YouTube's 500 characters.";
  if (m.publishAt && m.publishAt.getTime() < now + 15 * 60_000) return "A scheduled publish has to be at least 15 minutes ahead.";
  return null;
}

/** The video resource sent with the upload. */
export function videoResource(m: UploadMeta) {
  return {
    snippet: { title: m.title.trim(), description: m.description, tags: m.tags.filter(Boolean) },
    status: {
      privacyStatus: m.publishAt ? "private" : m.privacy,
      ...(m.publishAt ? { publishAt: m.publishAt.toISOString() } : {}),
      selfDeclaredMadeForKids: m.madeForKids,
      embeddable: true,
    },
  };
}

function failure(status: number, body: string): Error {
  let reason = "";
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } };
    reason = j.error?.errors?.[0]?.reason ?? "";
    const msg = j.error?.message ?? j.error?.errors?.[0]?.message ?? "";
    if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") return new Error(`YouTube refused the upload: the channel or the Cloud project is over its daily limit (${reason}). Try again tomorrow.`);
    if (status === 401) return new Error("YouTube no longer accepts this channel's sign-in — reconnect YouTube under Settings → Connections.");
    if (status === 403) return new Error(`YouTube refused the upload (${reason || "forbidden"}): ${msg || "the connected account may not be allowed to upload to this channel"}.`);
    if (msg) return new Error(`YouTube answered ${status}: ${msg}`);
  } catch { /* not JSON */ }
  return new Error(`YouTube answered ${status}${body ? `: ${body.slice(0, 200)}` : ""}.`);
}

/** Start an upload; returns YouTube's session address. */
export async function beginYoutubeUpload(token: string, meta: UploadMeta, size: number, contentType: string): Promise<string> {
  const res = await fetch(`${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": contentType,
    },
    body: JSON.stringify(videoResource(meta)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw failure(res.status, await res.text().catch(() => ""));
  const location = res.headers.get("location");
  if (!location) throw new Error("YouTube didn't give an address to upload to.");
  return location;
}

export type PieceReply = { received: number; videoId?: string; uploadStatus?: string };

async function reply(res: Response, total: number): Promise<PieceReply> {
  if (res.status === 200 || res.status === 201) {
    const v = (await res.json().catch(() => ({}))) as { id?: string; status?: { uploadStatus?: string } };
    if (!v.id) throw new Error("YouTube finished the upload but returned no video id.");
    return { received: total, videoId: v.id, uploadStatus: v.status?.uploadStatus };
  }
  if (res.status === 308) {
    const m = res.headers.get("range")?.match(/bytes=0-(\d+)/);
    return { received: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404 || res.status === 410) throw new UploadGone("YouTube no longer has this upload — it starts again.");
  if (res.status === 429 || res.status >= 500) throw new UploadBusy(`YouTube answered ${res.status}.`);
  throw failure(res.status, await res.text().catch(() => ""));
}

async function put(session: string, token: string, headers: Record<string, string>, body: Uint8Array | undefined, total: number, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(session, {
      method: "PUT",
      headers: { ...headers, Authorization: `Bearer ${token}` },
      ...(body ? { body: new Uint8Array(body) } : {}),
      // ⚠ 308 is "keep going", not a redirect.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UploadBusy(e instanceof Error ? e.message : "The connection to YouTube dropped.");
  }
  return reply(res, total);
}

export function sendYoutubePiece(session: string, token: string, start: number, bytes: Uint8Array, total: number) {
  return put(session, token, { "Content-Range": `bytes ${start}-${start + bytes.byteLength - 1}/${total}` }, bytes, total, 300_000);
}

export function youtubeUploadStatus(session: string, token: string, total: number) {
  return put(session, token, { "Content-Range": `bytes */${total}`, "Content-Length": "0" }, undefined, total, 30_000);
}

/** Set a custom thumbnail. A refusal (an unverified channel can't) comes back as a note, not an error. */
export async function setYoutubeThumbnail(token: string, videoId: string, bytes: Uint8Array, contentType: string): Promise<{ ok: boolean; note: string }> {
  if (bytes.byteLength > YT_THUMB_MAX) return { ok: false, note: "The thumbnail is over YouTube's 2 MB limit, so it wasn't set." };
  try {
    const res = await fetch(`${YT_UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return { ok: true, note: "Thumbnail set." };
    const body = await res.text().catch(() => "");
    return { ok: false, note: res.status === 403
      ? "YouTube didn't take the thumbnail — custom thumbnails need a verified channel (youtube.com/verify). The video is up; set it in Studio."
      : `YouTube didn't take the thumbnail (${res.status}${body ? `: ${body.slice(0, 120)}` : ""}). The video is up; set it in Studio.` };
  } catch (e) {
    return { ok: false, note: `The thumbnail didn't reach YouTube (${e instanceof Error ? e.message : "no answer"}). The video is up; set it in Studio.` };
  }
}

/** A stored file's key from the app URL it's served at (`/uploads/<key>` or `/api/files/<encoded>`). */
export function keyFromStoredUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const a = url.match(/^\/api\/files\/([^?#]+)/);
  if (a) { try { return decodeURIComponent(a[1]); } catch { return null; } }
  const b = url.match(/^\/uploads\/([^?#]+)/);
  return b ? b[1] : null;
}

export const VIDEO_EXT: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4" };
export function videoTypeOf(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXT[ext] ?? null;
}
