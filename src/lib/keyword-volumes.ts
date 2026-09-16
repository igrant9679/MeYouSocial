import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { getSetting } from "@/lib/settings";
import {
  DEFAULT_SEARCH_DATA_COUNTRY,
  getSearchDataProvider,
  isSearchDataCountry,
  searchDataVendorLabel,
} from "@/lib/search-data";

// The keyword strategy's numbers. Lives in lib (not the "use server" action
// file) because it takes a workspaceId — an export from an action module is a
// callable endpoint, and this one must only ever run behind an ACL check.

/** The country the workspace's volumes are measured for (`keywords:country`). */
export async function keywordCountry(workspaceId: string): Promise<string> {
  const v = await getSetting("keywords:country", workspaceId).catch(() => "");
  return isSearchDataCountry(v) ? v : DEFAULT_SEARCH_DATA_COUNTRY;
}

export type VolumeSyncResult =
  | { ok: true; vendor: string; country: string; updated: number; noData: number }
  | { ok: false; reason: "no_provider" | "nothing_to_fetch" | "failed"; error?: string };

/**
 * Fetch volume/CPC/competition for the workspace's keywords and store them.
 * `phrases` narrows the fetch (a just-added keyword); default = every active
 * keyword. Called by the Refresh button, by add/discover as a best-effort
 * follow-up, and by the assistant's refresh_keyword_volumes tool.
 */
export async function syncKeywordVolumes(workspaceId: string, phrases?: string[]): Promise<VolumeSyncResult> {
  const provider = await getSearchDataProvider(workspaceId);
  if (!provider) return { ok: false, reason: "no_provider" };
  const country = await keywordCountry(workspaceId);
  const rows = await db.keyword.findMany({
    where: { workspaceId, ...(phrases ? { phrase: { in: phrases } } : { status: "active" }) },
    select: { id: true, phrase: true },
    take: 1000,
  });
  if (!rows.length) return { ok: false, reason: "nothing_to_fetch" };
  let metrics;
  try {
    metrics = await provider.metrics([...new Set(rows.map((r) => r.phrase.toLowerCase()))], country);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await writeAudit({ workspaceId, action: "keywords.volume_sync_failed", entityType: "keyword", meta: { vendor: provider.vendor, country, error } });
    return { ok: false, reason: "failed", error };
  }
  const now = new Date();
  const source = `${searchDataVendorLabel(provider.vendor)} · ${country}`;
  let updated = 0;
  let noData = 0;
  for (const r of rows) {
    const m = metrics.get(r.phrase.toLowerCase());
    // A phrase the vendor returned nothing for is recorded as fetched-but-empty
    // (volumeAt set, volume null) so the page can say "no data" rather than
    // "not fetched yet".
    await db.keyword.update({
      where: { id: r.id },
      data: {
        volume: m?.volume ?? null,
        cpc: m?.cpc ?? null,
        competition: m?.competition ?? null,
        trend: m?.trend ? JSON.stringify(m.trend) : null,
        volumeSource: source,
        volumeAt: now,
      },
    });
    if (m?.volume != null) updated++;
    else noData++;
  }
  await writeAudit({ workspaceId, action: "keywords.volume_synced", entityType: "keyword", meta: { vendor: provider.vendor, country, updated, noData } });
  return { ok: true, vendor: provider.vendor, country, updated, noData };
}

/** Best-effort volumes for freshly written phrases; never fails the caller. */
export async function syncNewPhrases(workspaceId: string, phrases: string[]): Promise<void> {
  if (!phrases.length) return;
  try {
    await syncKeywordVolumes(workspaceId, phrases);
  } catch (e) {
    console.warn("[keywords] volume follow-up failed:", e instanceof Error ? e.message : e);
  }
}
