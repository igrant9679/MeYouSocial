import { getSetting } from "@/lib/settings";
import { getPublicUrl } from "@/lib/public-url";
import { hit, ipFrom, tooMany } from "@/lib/rate-limit";
import { handleMembershipCall } from "@/lib/membership/process";
import { SECRET_KEY, SIGNATURE_HEADER } from "@/lib/membership/signature";

/**
 * meyousocial.com's door into Publisher (2026-11-26): signed calls saying a member's plan started
 * or ended, or asking where a member goes now. The contract is docs/WEBSITE-SIGNUP-INTEGRATION.md;
 * the work is lib/membership/process.ts. Public by necessity (a server calls it, with no session),
 * so: HMAC-signed with the operator's secret, five-minute clock window, each event id applied once,
 * 64 KB at most, rate-limited per address. Outside the page proxy (`/api/` is excluded), no CSRF
 * concern (no cookies are read).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/** A plain answer for someone checking the address: it exists, it takes signed POSTs, and whether a secret is set. */
export async function GET() {
  const setUp = Boolean(await getSetting(SECRET_KEY));
  return Response.json({
    ok: true,
    endpoint: "MeYouSocial Publisher — membership events",
    accepts: "POST, JSON, signed with X-MeYouSocial-Signature",
    setUp,
  });
}

export async function POST(req: Request) {
  const limited = await hit("membershipPerIp", ipFrom(req.headers));
  if (!limited.ok) return tooMany(limited.retryAfter);
  let rawBody = "";
  try {
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ ok: false, outcome: "bad_request", message: "The body is over 64 KB." }, { status: 413 });
      }
      chunks.push(value);
    }
    rawBody = Buffer.concat(chunks).toString("utf8");
  } catch {
    return Response.json({ ok: false, outcome: "bad_request", message: "The body couldn't be read." }, { status: 400 });
  }
  const { status, body } = await handleMembershipCall({
    rawBody,
    signature: req.headers.get(SIGNATURE_HEADER),
    origin: await getPublicUrl(),
  });
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
