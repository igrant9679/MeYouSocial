import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { localProvider } from "@/lib/storage";

// GET /uploads/<key> — serves locally-stored files (dev default, and any files
// that predate the Drive backend). This route did not exist before: local
// StoredFile URLs pointed here but nothing answered, so every locally stored
// voiceover/render/upload 404'd in production. Session-gated like /api/files.
// Basic Range support so <video>/<audio> seeking works.

export const dynamic = "force-dynamic";

const EXT_TYPE: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  await requireMembership();
  const { key } = await params;
  const buf = await localProvider.get(key); // validates the key shape itself
  if (!buf) return new NextResponse("Not found", { status: 404 });

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  const type = EXT_TYPE[ext] ?? "application/octet-stream";
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
  });

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? parseInt(m[1], 10) : Math.max(0, buf.byteLength - parseInt(m[2], 10));
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), buf.byteLength - 1) : buf.byteLength - 1;
    if (start >= buf.byteLength || start > end) {
      headers.set("Content-Range", `bytes */${buf.byteLength}`);
      return new NextResponse(null, { status: 416, headers });
    }
    const slice = buf.subarray(start, end + 1);
    headers.set("Content-Range", `bytes ${start}-${end}/${buf.byteLength}`);
    headers.set("Content-Length", String(slice.byteLength));
    return new NextResponse(new Uint8Array(slice), { status: 206, headers });
  }

  headers.set("Content-Length", String(buf.byteLength));
  return new NextResponse(new Uint8Array(buf), { status: 200, headers });
}
