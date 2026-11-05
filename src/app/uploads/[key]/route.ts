import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { localProvider } from "@/lib/storage";
import { mayOpen } from "@/lib/storage/owners";
import { BASE_CSP, STORED_FILE_CSP } from "@/lib/csp";

// GET /uploads/<key> — serves locally-stored files (dev default, and any files
// that predate the Drive backend). This route did not exist before: local
// StoredFile URLs pointed here but nothing answered, so every locally stored
// voiceover/render/upload 404'd in production. Session-gated like /api/files.
// Basic Range support so <video>/<audio> seeking works.

export const dynamic = "force-dynamic";

/**
 * Tenant-uploaded bytes must never run as a page of this origin (audit
 * SEC-14): nosniff so the browser keeps our type, and a sandbox CSP so a file
 * opened directly can't script. PDFs are left out of the sandbox — Chrome
 * refuses to render a sandboxed PDF — and get the general policy. ⚠ This route
 * sends the WHOLE policy: next.config leaves it out of the general one, which
 * would otherwise replace this (lib/csp.ts).
 */
function storedFileHeaders(type: string): Record<string, string> {
  return { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": type.startsWith("application/pdf") ? BASE_CSP : STORED_FILE_CSP };
}

const EXT_TYPE: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
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
  const { user } = await requireMembership();
  const { key } = await params;
  // Another workspace's file is "not found", not "forbidden" — no confirmation it exists (E-SEC-11).
  if (!(await mayOpen(key, user))) return new NextResponse("Not found", { status: 404 });
  // Streamed, never loaded: a stored file can be 2,500 MB (E-ENG-13).
  const file = localProvider.pathOf(key); // validates the key shape itself
  const stat = file ? await fs.stat(file).catch(() => null) : null;
  if (!file || !stat?.isFile()) return new NextResponse("Not found", { status: 404 });
  const size = stat.size;
  const body = (start: number, end: number) => Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  const type = EXT_TYPE[ext] ?? "application/octet-stream";
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
    ...storedFileHeaders(type),
  });

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new NextResponse(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new NextResponse(body(start, end), { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  // An empty file has no last byte to read up to.
  return new NextResponse(size ? body(0, size - 1) : null, { status: 200, headers });
}
