import { STAGES, STAGE_HREFS, type StageCtx } from "@/lib/stages";
import { RAIL } from "@/lib/nav";

/**
 * The words the help, the guide and the assistant use for the app's map,
 * BUILT from the rail (lib/nav.ts) and the stages (lib/stages.ts) — E-SHL-12.
 *
 * They used to be written out by hand in three places (the assistant's app
 * map, its "the app, page by page" topic, the Help FAQ about the rail) and had
 * drifted: Topics and Evergreen were tabs the assistant had never heard of.
 * Now a tab added to a stage appears everywhere at once; the only hand-written
 * part is STAGE_NOTES — what a stage's tabs can't say for themselves.
 */

type StageHref = (typeof STAGE_HREFS)[number];

/** The loop itself: the stages work moves through, in order (Brand and Settings are setup, not loop). */
export const LOOP_STAGES = STAGE_HREFS.filter((h) => h !== "/brand" && h !== "/setup");

const ctx = (over: Partial<StageCtx>): StageCtx => ({ channelId: "<id>", studio: false, admin: false, operator: false, ...over });
const labels = (href: StageHref, c: StageCtx) => STAGES[href].tabs(c).map((t) => t.label);
const extra = (more: string[], than: string[]) => more.filter((l) => !than.includes(l));

/** What a stage's tabs don't say for themselves. Keep each to one clause. */
export const STAGE_NOTES: Partial<Record<StageHref, string>> = {
  "/ideas": "the Overview is one board for article, video and social ideas in each Topic's lane, columns Discovered/Approved/Drafted/Rejected",
  "/drafts": "Articles is one page with a Board/List toggle",
  "/publish": "Download HTML and Mark as published when there is no WordPress",
  "/measure": "Topics is what each Topic earned; the YouTube audit is the own-channel audit from the YouTube Analytics API",
  "/setup": "People is roles, invitations and require-approval; Automation is full autonomy, the pause, the weekly article target, the publish day, SEO on drafts, social auto-dials and function modes; Schedule is slots, time zone, best time, UTM and campaigns; Connections is what is connected and what is missing",
};

/** "Drafts (Articles; with the video studio on, also Scripts, Thumbnails, Videos, Production)" */
export function stageTabsPhrase(href: StageHref): string {
  const base = labels(href, ctx({}));
  const studio = extra(labels(href, ctx({ studio: true })), base);
  const admin = extra(labels(href, ctx({ admin: true })), base);
  const operator = extra(labels(href, ctx({ admin: true, operator: true })), [...base, ...admin]);
  const parts = [
    base.join(", "),
    studio.length ? `with the video studio on, also ${studio.join(", ")}` : "",
    admin.length ? `admins also see ${admin.join(", ")}` : "",
    operator.length ? `the platform operator also sees ${operator.join(", ")}` : "",
  ].filter(Boolean);
  return `${STAGES[href].label}${parts.length ? ` (${parts.join("; ")})` : ""}`;
}

/** Every stage with its tabs and its note: "Research (Intel, Bookmarks, Competitors) · Ideas (…) — the Overview is …". */
export function stagesAndTabs(): string {
  return STAGE_HREFS.map((h) => `${stageTabsPhrase(h)}${STAGE_NOTES[h] ? ` — ${STAGE_NOTES[h]}` : ""}`).join(" · ");
}

/** Where each stage's tabs live: "Research → /intel, /intel/bookmarks, /channels/<id>/competitors". */
export function stageUrls(): string {
  return STAGE_HREFS.map((h) => {
    const base = STAGES[h].tabs(ctx({}));
    const all = STAGES[h].tabs(ctx({ studio: true, admin: true }));
    const studio = all.filter((t) => !base.some((b) => b.href === t.href));
    return `${STAGES[h].label} → ${h}${base.length ? `, ${base.map((t) => t.href).join(", ")}` : ""}${studio.length ? ` (and ${studio.map((t) => t.href).join(", ")} when shown)` : ""}`;
  }).join(". ");
}

/** "Research → Ideas → Drafts → Publish → Distribute → Measure" */
export function loopSentence(): string {
  return LOOP_STAGES.map((h) => STAGES[h].label).join(" → ");
}

/** The rail, top to bottom, with each group named once: "Inbox · Assistant · … · Setup (Settings, Channels, Brand) · Help". */
export function railSentence(opts: { bold?: boolean } = {}): string {
  const b = (s: string) => (opts.bold ? `**${s}**` : s);
  const out: string[] = [];
  for (let i = 0; i < RAIL.length; i++) {
    const n = RAIL[i];
    if (!n.group) { out.push(b(n.label)); continue; }
    if (RAIL[i - 1]?.group === n.group) continue;
    const members = RAIL.filter((m) => m.group === n.group);
    out.push(`${b(n.group)} (${members.map((m) => b(m.label)).join(", ")}${members.every((m) => m.adminOnly) ? " — admins only" : ""})`);
  }
  return out.join(" · ");
}
