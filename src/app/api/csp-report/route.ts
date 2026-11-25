import { MAX_REPORT_BYTES, readReports } from "@/lib/csp-report";
import { hit, ipFrom } from "@/lib/rate-limit";

/**
 * Where browsers report what the page policy blocked (lib/csp.ts `pageCsp`,
 * `report-uri`). Each report becomes one `[csp]` line in the server log, so a
 * page that breaks under the policy shows up in Railway's logs — nothing is
 * stored. Public by necessity (the browser sends it, with no session), so:
 * rate-limited per address, 16 KB read at most, query strings dropped and
 * long path segments (share and approval tokens) masked.
 *
 * Takes both shapes: `application/csp-report` ({"csp-report": {...}}) and the
 * Reporting API's `application/reports+json` ([{type, body: {...}}]).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await hit("cspReportsPerIp", ipFrom(req.headers));
  if (!limited.ok) return new Response(null, { status: 204 });
  let text = "";
  try {
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > MAX_REPORT_BYTES) {
        await reader.cancel();
        return new Response(null, { status: 204 });
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } catch {
    return new Response(null, { status: 204 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  for (const line of readReports(body)) console.warn("[csp]", JSON.stringify(line));
  return new Response(null, { status: 204 });
}
