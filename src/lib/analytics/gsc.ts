import { getSetting } from "@/lib/settings";
import { explainGoogleError, googleAccessToken, googleApi, parseServiceAccount, type ServiceAccount } from "@/lib/google/service-account";

/**
 * Google Search Console connector — real ranking data (clicks, impressions,
 * position) for the workspace's own site.
 *
 * Access is via a service account: paste its JSON here, then add the SA's email
 * as a user on the property in Search Console. No OAuth dance, and it matches
 * the Drive-storage pattern the app already uses.
 *
 * Config is per-workspace (each company has its own site). The service account
 * falls back to the platform Drive SA, so an operator running one Google
 * project can grant that single SA access to every property instead of pasting
 * the same JSON repeatedly.
 */

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type GscConfig = { sa: ServiceAccount; siteUrl: string; saEmail: string };

/**
 * Search Console is picky about the site identifier: a Domain property is
 * `sc-domain:example.com`, a URL-prefix property is the exact origin WITH the
 * trailing slash. Normalize the common paste mistakes rather than fail later.
 */
export function normalizeSiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (raw.startsWith("sc-domain:")) return raw.toLowerCase();
  // A bare domain is ambiguous; treat it as a domain property, which is what
  // most people mean when they type "example.com".
  if (!/^https?:\/\//i.test(raw)) return `sc-domain:${raw.replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase()}`;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

async function resolveServiceAccount(workspaceId?: string | null): Promise<ServiceAccount | null> {
  const own = await getSetting("gsc:service_account", workspaceId).catch(() => "");
  if (own) return parseServiceAccount(own);
  // Fall back to the platform Drive service account (same Google project).
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "gdrive:service_account" } });
    return row?.value ? parseServiceAccount(row.value) : null;
  } catch {
    return null;
  }
}

export async function getGscConfig(workspaceId?: string | null): Promise<GscConfig | null> {
  const [sa, siteRaw] = await Promise.all([
    resolveServiceAccount(workspaceId),
    getSetting("gsc:site_url", workspaceId).catch(() => ""),
  ]);
  const siteUrl = normalizeSiteUrl(siteRaw ?? "");
  if (!sa || !siteUrl) return null;
  return { sa, siteUrl, saEmail: sa.client_email };
}

export async function gscConfigured(workspaceId?: string | null): Promise<boolean> {
  return (await getGscConfig(workspaceId)) !== null;
}

/**
 * Live probe: list the properties this service account can actually see, and
 * confirm the configured site is among them. Returns an actionable message —
 * "not shared with the SA" is by far the most common setup mistake.
 */
export async function gscVerify(workspaceId?: string | null): Promise<{ ok: boolean; message: string; sites?: string[] }> {
  const cfg = await getGscConfig(workspaceId);
  if (!cfg) return { ok: false, message: "Paste a service account and a site URL first." };
  try {
    const token = await googleAccessToken(cfg.sa, SCOPE);
    const data = await googleApi<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>(
      "https://www.googleapis.com/webmasters/v3/sites",
      token,
    );
    const sites = (data.siteEntry ?? []).map((s) => s.siteUrl);
    if (!sites.length) {
      return {
        ok: false,
        message: `No properties are shared with ${cfg.saEmail}. In Search Console → Settings → Users and permissions, add that address as a user.`,
        sites,
      };
    }
    if (!sites.includes(cfg.siteUrl)) {
      return {
        ok: false,
        message: `The service account can see ${sites.length} propert${sites.length === 1 ? "y" : "ies"} (${sites.slice(0, 3).join(", ")}) but not "${cfg.siteUrl}". Copy the identifier exactly as Search Console shows it.`,
        sites,
      };
    }
    return { ok: true, message: `Connected to ${cfg.siteUrl}.`, sites };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Verification failed";
    // A disabled Search Console API and an ungranted service account both come
    // back as 403 — explainGoogleError tells them apart and names the fix.
    return {
      ok: false,
      message: explainGoogleError(raw, {
        grantHint: `Add ${cfg.saEmail} as a user on this property in Search Console → Settings → Users and permissions.`,
      }),
    };
  }
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

/**
 * Query Search Analytics. `dimensions` is typically ["query"] or ["page"].
 * Dates are YYYY-MM-DD; GSC data lags ~2 days, so callers should not ask for
 * today and treat an empty result as "no data yet", never as zero traffic.
 */
export async function gscQuery(
  workspaceId: string | null | undefined,
  opts: { startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number },
): Promise<GscRow[]> {
  const cfg = await getGscConfig(workspaceId);
  if (!cfg) return [];
  const token = await googleAccessToken(cfg.sa, SCOPE);
  const data = await googleApi<{ rows?: GscRow[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}/searchAnalytics/query`,
    token,
    {
      method: "POST",
      body: {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions ?? ["query"],
        rowLimit: Math.min(opts.rowLimit ?? 100, 500),
      },
    },
  );
  return data.rows ?? [];
}
