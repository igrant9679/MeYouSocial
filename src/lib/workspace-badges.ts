import { stripCounts } from "@/lib/stage-counts";
import { unreadCount } from "@/lib/notify";

/**
 * The workspace switcher's badges and landing page (E-SHL-05).
 *
 * Badges: for each other workspace, what needs this person there — the stage
 * strip's urgent counts (held articles, approvals, open audit items, unread
 * replies; the same lower bound the strip shows) — and their unread
 * notifications. The strip's counts are cached for 10 s per workspace; only the
 * first few workspaces are counted, so an operator in dozens isn't charged for
 * all of them on every page.
 */

const MAX_COUNTED = 8;
export type WorkspaceBadge = { needsYou: number; unread: number };

export async function workspaceBadges(userId: string, workspaceIds: string[]): Promise<Map<string, WorkspaceBadge>> {
  const ids = workspaceIds.slice(0, MAX_COUNTED);
  const rows = await Promise.all(ids.map(async (id) => {
    const [counts, unread] = await Promise.all([stripCounts(id).catch(() => ({})), unreadCount(id, userId)]);
    const needsYou = Object.values(counts).reduce((n, c) => n + (c.urgent ? c.n : 0), 0);
    return [id, { needsYou, unread }] as const;
  }));
  return new Map(rows);
}

/**
 * Where switching lands: the same section of the app, minus anything that
 * names one record (an id belongs to the workspace being left — opening it in
 * the other would be "not found"), and never a query string. Anything that
 * isn't a plain in-app path goes to the Inbox.
 */
export function switchLanding(raw: string | null | undefined): string {
  const p = (raw ?? "").trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\") || /[\s?#]/.test(p.split(/[?#]/)[0] ?? "")) return "/inbox";
  const path = p.split(/[?#]/)[0];
  if (/^\/(api|auth|signin|signout|onboarding|invitations|reset|verify|uploads|forbidden)(\/|$)/.test(path)) return "/inbox";
  const kept: string[] = [];
  for (const seg of path.split("/").filter(Boolean)) {
    if (/^[a-z0-9]{20,}$/i.test(seg) || /^\d+$/.test(seg)) break; // a record's id — stop at its section
    if (!/^[a-z0-9-]+$/i.test(seg)) return "/inbox";
    kept.push(seg);
  }
  return kept.length ? `/${kept.join("/")}` : "/inbox";
}
