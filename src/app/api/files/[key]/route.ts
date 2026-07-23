import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { GDRIVE_KEY_PREFIX, gdriveFetchMedia } from "@/lib/storage/gdrive";

// GET /api/files/gdrive:<fileId> — streams a Drive-stored file to signed-in
// members. Files stay private in Drive; the Range header is forwarded so
// <video> seeking works (Drive answers 206 + Content-Range and we pass both
// through). Each view streams through this server — the honest cost of not
// making files public-by-link.

export const dynamic = "force-dynamic";

const PASSTHROUGH_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  await requireMembership();
  const raw = (await params).key;
  let key = raw;
  try {
    key = decodeURIComponent(raw);
  } catch {
    // leave as-is
  }
  if (!key.startsWith(GDRIVE_KEY_PREFIX)) return new NextResponse("Not found", { status: 404 });
  const fileId = key.slice(GDRIVE_KEY_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return new NextResponse("Bad key", { status: 400 });

  let upstream: Response;
  try {
    upstream = await gdriveFetchMedia(fileId, req.headers.get("range") ?? undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Drive fetch failed";
    return new NextResponse(msg, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse("Not found", { status: upstream.status === 404 ? 404 : 502 });
  }

  const headers = new Headers({ "Cache-Control": "private, max-age=3600" });
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
