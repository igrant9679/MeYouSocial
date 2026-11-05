/**
 * What can be attached as research, and how it's told apart (E-ENG-13). Safe in
 * the browser: the paperclip shows these limits, the upload route enforces them.
 */

export type UploadKind = "pdf" | "word" | "text" | "image";

/** 2500 MB. Over 512 MB (READ_MAX_BYTES) a file is kept but not read. */
export const UPLOAD_MAX_BYTES = 2500 * 1024 * 1024;
/** One piece of an upload. A multiple of 256 KiB (Drive's rule); small enough to finish inside Railway's five minutes on a slow line. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export const UPLOAD_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.json,.csv,.jpg,.jpeg,.png,.gif,.webp";

const BY_EXT: Record<string, { kind: UploadKind; contentType: string }> = {
  ".pdf": { kind: "pdf", contentType: "application/pdf" },
  ".docx": { kind: "word", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".txt": { kind: "text", contentType: "text/plain" },
  ".md": { kind: "text", contentType: "text/markdown" },
  ".markdown": { kind: "text", contentType: "text/markdown" },
  ".csv": { kind: "text", contentType: "text/csv" },
  ".json": { kind: "text", contentType: "application/json" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".png": { kind: "image", contentType: "image/png" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".webp": { kind: "image", contentType: "image/webp" },
};

const BY_TYPE: Record<string, { kind: UploadKind; contentType: string }> = Object.fromEntries(
  Object.values(BY_EXT).map((v) => [v.contentType, v]),
);

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
};

/**
 * The extension speaks first: Windows browsers report a .csv as a spreadsheet and
 * a .md as nothing at all. A stored file only ever gets a type from this list,
 * never the one the browser claimed.
 */
export function uploadKind(name: string, browserType: string): { kind: UploadKind; contentType: string } | null {
  return BY_EXT[extOf(name)] ?? BY_TYPE[browserType.split(";")[0].trim().toLowerCase()] ?? null;
}

/** Why this file can't be attached, in words that say what to do instead. */
export function refusalFor(name: string, browserType: string): string {
  const ext = extOf(name);
  if (ext === ".doc" || browserType === "application/msword") return "Old .doc files can't be read. Open it in Word, save it as .docx, and attach that.";
  if (browserType.startsWith("video/") || browserType.startsWith("audio/")) return "Video and sound can't be attached here — the assistant can't watch or listen to them. A video for a post goes in Distribute → Media.";
  return "That type of file can't be attached. PDF, Word (.docx), text, Markdown, CSV, JSON and images (JPEG, PNG, GIF, WebP) can.";
}

/** Is this what its name says? Read from the first bytes — a name proves nothing. Null when it is. Pure. */
export function contentProblem(kind: UploadKind, head: Uint8Array, name: string): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  const short = name.slice(0, 80);
  if (kind === "pdf") return ascii(0, Math.min(head.length, 1024)).includes("%PDF-") ? null : `${short} doesn't read as a PDF.`;
  if (kind === "word") {
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return `${short} is an old .doc file with a new name. Open it in Word, save it as .docx, and attach that.`;
    return head[0] === 0x50 && head[1] === 0x4b ? null : `${short} doesn't read as a Word document.`;
  }
  if (kind === "image") {
    const png = head[0] === 0x89 && ascii(1, 4) === "PNG";
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    const gif = ascii(0, 3) === "GIF";
    const webp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    return png || jpeg || gif || webp ? null : `${short} doesn't read as a JPEG, PNG, GIF or WebP image.`;
  }
  return head.subarray(0, 8192).includes(0) ? `${short} doesn't read as text.` : null;
}

/** "850 MB", "2,500 MB" — megabytes all the way up, so the limit reads as it was set. Pure. */
export function formatBytes(n: number): string {
  if (n <= 0) return "0 MB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${Math.round(n / (1024 * 1024)).toLocaleString("en-US")} MB`;
}
