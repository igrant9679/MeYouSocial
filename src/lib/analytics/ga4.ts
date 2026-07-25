import { getSetting } from "@/lib/settings";
import { googleAccessToken, googleApi, parseServiceAccount, type ServiceAccount } from "@/lib/google/service-account";

/**
 * GA4 (Google Analytics 4) connector — sessions, users and conversions for the
 * workspace's own site, via the Data API.
 *
 * Same service-account model as the Search Console connector: paste the SA JSON
 * (or reuse the platform Drive SA) and grant that address Viewer on the GA4
 * property. Config is per-workspace.
 */

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type Ga4Config = { sa: ServiceAccount; propertyId: string; saEmail: string };

/** Accepts "123456789", "properties/123456789", or a pasted admin URL. */
export function normalizePropertyId(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const digits = raw.match(/(\d{6,})/);
  return digits ? digits[1] : "";
}

async function resolveServiceAccount(workspaceId?: string | null): Promise<ServiceAccount | null> {
  const own = await getSetting("ga4:service_account", workspaceId).catch(() => "");
  if (own) return parseServiceAccount(own);
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "gdrive:service_account" } });
    return row?.value ? parseServiceAccount(row.value) : null;
  } catch {
    return null;
  }
}

export async function getGa4Config(workspaceId?: string | null): Promise<Ga4Config | null> {
  const [sa, propRaw] = await Promise.all([
    resolveServiceAccount(workspaceId),
    getSetting("ga4:property_id", workspaceId).catch(() => ""),
  ]);
  const propertyId = normalizePropertyId(propRaw ?? "");
  if (!sa || !propertyId) return null;
  return { sa, propertyId, saEmail: sa.client_email };
}

export async function ga4Configured(workspaceId?: string | null): Promise<boolean> {
  return (await getGa4Config(workspaceId)) !== null;
}

/**
 * Live probe: run a tiny report. This exercises the exact permission the app
 * needs, so a pass here means real queries will work — stronger than reading
 * metadata. An empty-but-successful report is still a pass (a new property
 * legitimately has no data).
 */
export async function ga4Verify(workspaceId?: string | null): Promise<{ ok: boolean; message: string }> {
  const cfg = await getGa4Config(workspaceId);
  if (!cfg) return { ok: false, message: "Paste a service account and a GA4 property ID first." };
  try {
    const token = await googleAccessToken(cfg.sa, SCOPE);
    const data = await googleApi<{ rows?: Array<{ metricValues?: Array<{ value: string }> }>; rowCount?: number }>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(cfg.propertyId)}:runReport`,
      token,
      {
        method: "POST",
        body: {
          dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
          metrics: [{ name: "sessions" }],
          limit: 1,
        },
      },
    );
    const sessions = data.rows?.[0]?.metricValues?.[0]?.value ?? "0";
    return { ok: true, message: `Connected to property ${cfg.propertyId} — ${sessions} sessions in the last 28 days.` };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Verification failed";
    // The permission error is the common one; name the fix.
    const hint = /permission|403/i.test(raw)
      ? ` Grant ${cfg.saEmail} the Viewer role on this property (GA4 → Admin → Property access management).`
      : "";
    return { ok: false, message: `${raw.slice(0, 250)}${hint}` };
  }
}

export type Ga4Row = { dimensions: string[]; metrics: string[] };

/**
 * Run a report. Dimensions/metrics are GA4 API names, e.g.
 * dimensions ["pagePath"], metrics ["sessions","totalUsers"].
 */
export async function ga4RunReport(
  workspaceId: string | null | undefined,
  opts: { startDate: string; endDate: string; dimensions?: string[]; metrics?: string[]; limit?: number },
): Promise<Ga4Row[]> {
  const cfg = await getGa4Config(workspaceId);
  if (!cfg) return [];
  const token = await googleAccessToken(cfg.sa, SCOPE);
  const data = await googleApi<{
    rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
  }>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(cfg.propertyId)}:runReport`,
    token,
    {
      method: "POST",
      body: {
        dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
        dimensions: (opts.dimensions ?? ["pagePath"]).map((name) => ({ name })),
        metrics: (opts.metrics ?? ["sessions"]).map((name) => ({ name })),
        limit: Math.min(opts.limit ?? 100, 500),
      },
    },
  );
  return (data.rows ?? []).map((r) => ({
    dimensions: (r.dimensionValues ?? []).map((d) => d.value),
    metrics: (r.metricValues ?? []).map((m) => m.value),
  }));
}
