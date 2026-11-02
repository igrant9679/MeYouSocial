import { networkFor } from "@/lib/social/networks";
import { isValidTimeZone, parseZonedInput } from "@/lib/social/slots";

/**
 * Social CSV import, as a plan (E-SOC-16): each row checked and turned into
 * what it would create, or the reason it can't — the same judgement for
 * "Check the file" (nothing written) and "Import". Columns, header row,
 * case-insensitive:
 *   text (required) · scheduledAt · timezone · networks · campaign · category ·
 *   evergreen · recycleEveryDays · media
 * `timezone` is an IANA zone for that row's date (empty = the posting zone);
 * `media` names items in the media library (by name or key, "|"-separated).
 * Unknown campaigns and media are row errors, never invented.
 */

export const CSV_MAX_ROWS = 200;
export const CSV_MAX_BYTES = 1024 * 1024;
export const COLUMNS = ["text", "scheduledAt", "timezone", "networks", "campaign", "category", "evergreen", "recycleEveryDays", "media"] as const;

/**
 * RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, a BOM ignored.
 * Blank rows are KEPT (as empty arrays) so "row 12" in a message is row 12 of
 * the spreadsheet; the planner skips them.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row.some((f) => f.trim() !== "") ? row : []);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  // Trailing blank lines carry no rows.
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

export type Account = { platform: string; accountId: string; displayName: string | null; username: string | null };
export type Media = { key: string; name: string; contentType: string | null };
export type PlanContext = {
  accounts: Account[];
  campaigns: Array<{ id: string; name: string }>;
  media: Media[];
  timeZone: string;
  now: number;
};
export type PlannedPost = {
  text: string;
  scheduledAt: Date | null;
  campaignId: string | null;
  category: string | null;
  evergreen: boolean;
  recycleEveryDays: number;
  mediaKeys: string[];
  targets: Array<{ provider: string; accountId: string; accountName: string }>;
  zone: string;
};
export type RowPlan = { row: number; ok: boolean; error?: string; notes: string[]; post?: PlannedPost };

const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

export function planImport(rows: string[][], ctx: PlanContext): { header: string | null; plans: RowPlan[] } {
  const dataRows = rows.slice(1).filter((r) => r.length > 0).length;
  if (!rows.length || dataRows === 0) return { header: "The file needs a header row and at least one post row.", plans: [] };
  if (dataRows > CSV_MAX_ROWS) return { header: `That's ${dataRows} rows — the cap is ${CSV_MAX_ROWS} per import.`, plans: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iText = col("text");
  if (iText === -1) return { header: 'The header row needs a "text" column.', plans: [] };
  if (!ctx.accounts.length) return { header: "No connected social accounts to import against.", plans: [] };
  const [iWhen, iZone, iNets, iCampaign, iCategory, iEver, iDays, iMedia] = ["scheduledat", "timezone", "networks", "campaign", "category", "evergreen", "recycleeverydays", "media"].map(col);
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

  const byPlatform = new Map<string, Account[]>();
  for (const a of ctx.accounts) (byPlatform.get(a.platform) ?? byPlatform.set(a.platform, []).get(a.platform)!).push(a);
  const campaignByName = new Map(ctx.campaigns.map((c) => [c.name.toLowerCase(), c.id]));
  const mediaBy = new Map<string, Media>();
  for (const m of ctx.media) { mediaBy.set(m.key.toLowerCase(), m); if (!mediaBy.has(m.name.toLowerCase())) mediaBy.set(m.name.toLowerCase(), m); }

  const plans: RowPlan[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const row = r + 1; // the spreadsheet's numbering, header = row 1
    if (cells.length === 0) continue; // a blank row: nothing to say about it
    const notes: string[] = [];
    const fail = (error: string) => plans.push({ row, ok: false, error, notes });
    const text = cell(cells, iText).slice(0, 5000);
    if (!text) { fail("empty text"); continue; }

    // Media from the library, so media-only networks can be kept.
    const mediaNames = cell(cells, iMedia) ? cell(cells, iMedia).split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4) : [];
    const items: Media[] = [];
    const missing: string[] = [];
    for (const n of mediaNames) { const m = mediaBy.get(n.toLowerCase()); if (m) items.push(m); else missing.push(n); }
    if (missing.length) { fail(`not in the media library: ${missing.join(", ")}`); continue; }
    const hasVideo = items.some((m) => m.contentType?.startsWith("video/") || VIDEO.test(m.key));

    const netRaw = cell(cells, iNets);
    const wanted = netRaw ? netRaw.toLowerCase().split(/[|;,\s]+/).filter(Boolean) : [...byPlatform.keys()];
    const unknown = wanted.filter((w) => !byPlatform.has(w));
    if (unknown.length && netRaw) { fail(`no connected account for ${unknown.join(", ")}`); continue; }
    const fits = (w: string) => { const n = networkFor(w); return !(n?.requiresVideo && !hasVideo) && !(n?.requiresMedia && items.length === 0); };
    const usable = wanted.filter((w) => byPlatform.has(w) && fits(w));
    const dropped = wanted.filter((w) => byPlatform.has(w) && !fits(w));
    if (dropped.length) notes.push(`skipped ${dropped.join(", ")} (${dropped.some((w) => networkFor(w)?.requiresVideo) && items.length ? "needs a video" : "needs an image"})`);
    if (!usable.length) { fail(items.length ? "every named network needs a video" : "every named network needs an image — add one from the media library in the media column"); continue; }

    let campaignId: string | null = null;
    if (cell(cells, iCampaign)) {
      campaignId = campaignByName.get(cell(cells, iCampaign).toLowerCase()) ?? null;
      if (!campaignId) { fail(`unknown campaign “${cell(cells, iCampaign)}”`); continue; }
    }

    // The date is wall clock in the row's zone, else the posting zone.
    const zone = cell(cells, iZone) || ctx.timeZone;
    if (cell(cells, iZone) && !isValidTimeZone(zone)) { fail(`unknown timezone “${zone}” — use a name like Europe/London`); continue; }
    let scheduledAt: Date | null = null;
    if (cell(cells, iWhen)) {
      const t = parseZonedInput(cell(cells, iWhen), zone);
      if (!t) { fail(`unreadable date “${cell(cells, iWhen)}” — write it as 2026-12-11 09:00`); continue; }
      if (t.getTime() < ctx.now - 60_000) { fail("that time has already passed"); continue; }
      scheduledAt = t;
    }

    plans.push({
      row, ok: true, notes,
      post: {
        text, scheduledAt, campaignId, zone,
        category: cell(cells, iCategory).slice(0, 40) || null,
        evergreen: /^(true|yes|1|y)$/i.test(cell(cells, iEver)),
        recycleEveryDays: iDays >= 0 ? Math.min(365, Math.max(1, parseInt(cell(cells, iDays), 10) || 30)) : 30,
        mediaKeys: items.map((m) => m.key),
        targets: usable.flatMap((p) => byPlatform.get(p)!).map((a) => ({ provider: a.platform, accountId: a.accountId, accountName: a.displayName ?? a.username ?? a.platform })),
      },
    });
  }
  return { header: null, plans };
}
