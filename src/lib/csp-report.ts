/**
 * Reading the reports browsers send to /api/csp-report (lib/csp.ts `pageCsp`).
 * Kept out of the route file: a route may export only its handlers.
 */

export const MAX_REPORT_BYTES = 16 * 1024;

export type CspReportLine = { directive: string; blocked: string; page: string; source: string; line: number | null; mode: string };

/** A URL as path only, with token-like segments masked; "inline", "eval" and the like pass through. */
export function tidyUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw.slice(0, 40);
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return u.protocol;
    const path = u.pathname
      .split("/")
      .map((seg) => (/^[A-Za-z0-9_-]{20,}$/.test(seg) ? ":token" : seg))
      .join("/");
    return `${u.host}${path}`.slice(0, 200);
  } catch {
    return "";
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The reports in a body, in one shape; anything that isn't a CSP report is dropped. */
export function readReports(body: unknown): CspReportLine[] {
  const out: CspReportLine[] = [];
  const legacy = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    out.push({
      directive: str(legacy["effective-directive"]) || str(legacy["violated-directive"]).split(" ")[0],
      blocked: tidyUrl(legacy["blocked-uri"]),
      page: tidyUrl(legacy["document-uri"]),
      source: tidyUrl(legacy["source-file"]),
      line: typeof legacy["line-number"] === "number" ? legacy["line-number"] : null,
      mode: str(legacy.disposition) || "enforce",
    });
  }
  if (Array.isArray(body)) {
    for (const r of body.slice(0, 20)) {
      const b = (r as { type?: unknown; body?: Record<string, unknown> })?.body;
      if ((r as { type?: unknown })?.type !== "csp-violation" || !b || typeof b !== "object") continue;
      out.push({
        directive: str(b.effectiveDirective),
        blocked: tidyUrl(b.blockedURL),
        page: tidyUrl(b.documentURL),
        source: tidyUrl(b.sourceFile),
        line: typeof b.lineNumber === "number" ? b.lineNumber : null,
        mode: str(b.disposition) || "enforce",
      });
    }
  }
  return out.map((l) => ({ ...l, directive: l.directive.slice(0, 40), mode: l.mode.slice(0, 12) }));
}
