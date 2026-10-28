import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getModes, isGloballyPaused } from "@/lib/governance";
import { networkFor } from "@/lib/social/networks";

/**
 * Why the engine WON'T turn approved ideas into drafts by itself right now —
 * one sentence per format, or null when it will (IDE-05).
 *
 * The board's Approved column promised "the engine makes it" whatever the
 * dials said. Article drafting only runs with `blog_drafting` assisted/auto;
 * social drafting needs social assisted/auto, `social:autogen` on, the ideas
 * source (not the rotation rollback), an account that takes a text post and
 * the weekly quota. Each blocker here mirrors one of those checks in
 * lib/blog-autopilot.ts and lib/social/drafting.ts — keep them in step.
 *
 * Draft now always works regardless; these say when it is the only way.
 */
/** Why, and where to change it (E-IDE-05) — no link when nothing in the app does. */
export type Blocker = { text: string; href?: string };
export type DraftingBlockers = { article: Blocker | null; social: Blocker | null };
const AUTOMATION = "/setup/automation";

const WEEK_MS = 7 * 86_400_000;

export async function draftingBlockers(workspaceId: string): Promise<DraftingBlockers> {
  if (process.env.AUTOPILOT === "off") {
    const off = { text: "The autopilot is switched off on this server, so nothing is drafted by itself — use Draft now." };
    return { article: off, social: off };
  }
  if (await isGloballyPaused(workspaceId)) {
    const paused = { text: "Everything is paused (Settings → Automation), so nothing is drafted until it resumes.", href: AUTOMATION };
    return { article: paused, social: paused };
  }
  const { generationsToday, DAILY_AI_BUDGET } = await import("@/lib/blog-autopilot");
  const [modes, used] = await Promise.all([getModes(workspaceId), generationsToday(workspaceId)]);
  const unattended = (m: string) => m === "assisted" || m === "auto";
  const budget = used >= DAILY_AI_BUDGET ? { text: `Today's ${DAILY_AI_BUDGET} unattended AI runs are used, so drafting resumes tomorrow — or use Draft now.` } : null;

  let article: Blocker | null = null;
  if (!unattended(modes.blog_drafting)) article = { text: "Article drafting is manual (Settings → Automation), so approved ideas wait for Draft now.", href: AUTOMATION };
  else if (budget) article = budget;
  else {
    const weekly = parseInt(await getSetting("autopilot:weekly_articles", workspaceId).catch(() => ""), 10);
    if (Number.isFinite(weekly) && weekly > 0) {
      const done = await db.auditLog.count({ where: { workspaceId, action: "blog.draft_generated", createdAt: { gte: new Date(Date.now() - WEEK_MS) } } });
      if (done >= weekly) article = { text: `This week's ${weekly} article${weekly === 1 ? " is" : "s are"} drafted; the next waits for the rolling week — or use Draft now.`, href: AUTOMATION };
    }
  }

  let social: Blocker | null = null;
  const [autogen, source] = await Promise.all([
    getSetting("social:autogen", workspaceId).catch(() => ""),
    getSetting("social:source", workspaceId).catch(() => ""),
  ]);
  if (!unattended(modes.social)) social = { text: "Social is manual (Settings → Automation), so approved social ideas wait for Draft now.", href: AUTOMATION };
  else if (budget) social = budget;
  else if (source.trim() === "rotation") social = { text: "Social posts come from Topic rotation on this workspace, not from these ideas — use Draft now." };
  else if (autogen !== "true") social = { text: "Social drafting is switched off (Settings → Automation), so approved social ideas wait for Draft now.", href: AUTOMATION };
  else {
    const accounts = await db.zernioAccount.findMany({ where: { workspaceId, status: "connected" }, select: { platform: true } });
    if (!accounts.some((a) => !networkFor(a.platform)?.requiresMedia)) {
      social = { text: "No connected account takes a text-only post, so the engine can't write one — connect one under Settings → Connections.", href: "/setup/connections" };
    } else {
      const target = Math.min(50, Math.max(1, parseInt(await getSetting("social:autogen_weekly", workspaceId).catch(() => ""), 10) || 5));
      const done = await db.auditLog.count({ where: { workspaceId, action: "social.post_generated", createdAt: { gte: new Date(Date.now() - WEEK_MS) } } });
      if (done >= target) social = { text: `This week's ${target} social post${target === 1 ? " is" : "s are"} written; the next waits for the rolling week — or use Draft now.`, href: AUTOMATION };
    }
  }
  return { article, social };
}
