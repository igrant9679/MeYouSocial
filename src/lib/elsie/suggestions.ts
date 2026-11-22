import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getHomeData, type HomeDecision } from "@/lib/home";
import { openRecommendations } from "@/lib/recommendations";
import { canFollow } from "@/lib/role-links";
import { stageFor } from "@/lib/stages";

/**
 * What Elsie suggests, beside whatever page is open (2026-11-16, the owner's
 * "Elsie pane").
 *
 * ⚠ FROM DATA, NOT FROM A MODEL. Every suggestion is one of the Inbox's own
 * decisions (lib/home.ts — measured counts, things a person can act on) or an
 * open recommendation (lib/recommendations — rules over the metrics). Nothing
 * here calls a model, so moving between pages costs nothing and she can't
 * suggest something that isn't there. Her judgement comes in when a person
 * presses "Ask Elsie" on one: that is an ordinary turn, with the ordinary
 * proposal card and its Yes.
 *
 * The page decides the ORDER, not the list: suggestions whose own page is in
 * the stage being looked at come first ("On this page"), the rest follow.
 *
 * Rules that keep her quiet:
 *   - Only what this person can act on. A link their role can't open is left
 *     out (lib/role-links.ts), and a viewer — who can change nothing — gets
 *     none at all, only questions to ask.
 *   - A dismissed suggestion stays dismissed (`ElsieDismissal`), for that
 *     person in that workspace, until they ask for them back.
 */

export type ElsieSuggestion = {
  /** Stable: "home:<decision kind>" or "rec:<recommendation id>" — what a dismissal stores. */
  key: string;
  title: string;
  why: string;
  /** Something is waiting on a person, as opposed to an opening worth taking. */
  urgent: boolean;
  href: string;
  cta: string;
  /** What "Ask Elsie" sends — a question or an instruction her tools can carry out. */
  ask: string;
};

export type ElsieSuggestions = {
  /** Belonging to the stage being looked at. */
  here: ElsieSuggestion[];
  /** Everything else, most pressing first — at most NEXT_MAX of them. */
  next: ElsieSuggestion[];
  /** How many more there are beyond `next` (they are all in the Inbox). */
  more: number;
  /** Suggestions that would show now but this person dismissed. */
  hidden: number;
  /** here + next + more: the number on her button. */
  count: number;
};

export const NEXT_MAX = 4;
const RECS_MAX = 2;
const EMPTY: ElsieSuggestions = { here: [], next: [], more: 0, hidden: 0, count: 0 };

/**
 * An editor can OPEN these pages and act on nothing there: approving a post is
 * an admin's (the Inbox files it under "Waiting on an admin" for the same reason).
 */
const ADMINS_ACT = new Set(["home:awaiting-approval"]);

/** A dismissal's key: one of ours, nothing else. */
export const DISMISS_KEY = /^(home|rec):[A-Za-z0-9_-]{1,80}$/;

/** What to ask about a decision — where a better question exists than the general one. */
const ASK_FOR: Record<string, string> = {
  "blog-review": "Which article waiting for review should I read first, and what should I check in it?",
  "blog-ideas": "Which ideas waiting for a decision fit our audience best, and why?",
  "ideas-approved-stuck": "Draft the next approved idea",
  "awaiting-approval": "Summarise the posts waiting for approval and point out anything I should look at closely",
  "changes-requested": "Which posts were sent back for changes, and what was asked for?",
  "failed-legs": "Which sends failed, and why?",
  "inbox-unseen": "Summarise the replies nobody has opened yet",
  "drafts-idle": "Which post drafts have been sitting longest, and are they worth finishing?",
  "search-clicks-drop": "Which articles are losing search clicks, and what would you do about each?",
  "fell-off-page-one": "Which articles fell off page one, and what would you do about each?",
};

function fromDecision(d: HomeDecision): ElsieSuggestion {
  return {
    key: `home:${d.kind}`,
    title: d.title,
    why: d.detail,
    urgent: d.severity === "warn",
    href: d.href,
    cta: d.cta,
    ask: ASK_FOR[d.kind] ?? `About "${d.title}": what is behind it, and what would you do?`,
  };
}

type Recommendation = Awaited<ReturnType<typeof openRecommendations>>[number];

function fromRecommendation(r: Recommendation): ElsieSuggestion {
  return {
    key: `rec:${r.id}`,
    title: r.title,
    why: r.detail.length > 180 ? r.detail.slice(0, 177).trimEnd() + "…" : r.detail,
    urgent: r.severity === "warning",
    href: "/insights",
    cta: "Open Insights",
    ask: `About the recommendation "${r.title}": explain the evidence, and say what you would do.`,
  };
}

// The Inbox's decisions take about twenty counts. The pane asks on every page
// it's open beside, so one workspace's answer is kept briefly — short enough
// that a suggestion clears within a click or two of the thing being done.
const TTL_MS = 45_000;
const cache = new Map<string, { at: number; value: ElsieSuggestion[] }>();

async function workspaceSuggestions(workspaceId: string): Promise<ElsieSuggestion[]> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [home, recs] = await Promise.all([
    getHomeData(workspaceId),
    openRecommendations(workspaceId, RECS_MAX).catch(() => [] as Recommendation[]),
  ]);
  const all = [...home.decisions.map(fromDecision), ...recs.map(fromRecommendation)];
  // One per key: two decisions of a kind would share a dismissal and a React key.
  const seen = new Set<string>();
  const value = all.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

/** For tests and for the moment after a dismissal's workspace changes under it. */
export function forgetElsieCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

export async function elsieSuggestions(opts: { workspaceId: string; userId: string; role: Role; page: string | null }): Promise<ElsieSuggestions> {
  // A viewer can open most of these pages and act on none of it (SHL-07).
  if (opts.role === "VIEWER") return EMPTY;
  const [all, dismissed] = await Promise.all([
    workspaceSuggestions(opts.workspaceId),
    db.elsieDismissal.findMany({ where: { workspaceId: opts.workspaceId, userId: opts.userId }, select: { key: true } }),
  ]);
  const gone = new Set(dismissed.map((d) => d.key));
  const mine = all.filter((s) => canFollow(s.href, opts.role) && (opts.role === "ADMIN" || !ADMINS_ACT.has(s.key)));
  const shown = mine.filter((s) => !gone.has(s.key));
  const stage = opts.page ? stageFor(opts.page.split(/[?#]/)[0]) : null;
  const belongs = (s: ElsieSuggestion) => stage !== null && stageFor(s.href.split(/[?#]/)[0]) === stage;
  // Waiting-on-a-person first; the sources' own order otherwise (sort is stable).
  const pressing = (list: ElsieSuggestion[]) => [...list].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const here = pressing(shown.filter(belongs));
  const rest = pressing(shown.filter((s) => !belongs(s)));
  return {
    here,
    next: rest.slice(0, NEXT_MAX),
    more: Math.max(0, rest.length - NEXT_MAX),
    hidden: mine.length - shown.length,
    count: shown.length,
  };
}

/** "Don't suggest this again" — this person, this workspace. */
export async function dismissElsieSuggestion(workspaceId: string, userId: string, key: string): Promise<boolean> {
  if (!DISMISS_KEY.test(key)) return false;
  await db.elsieDismissal.upsert({
    where: { workspaceId_userId_key: { workspaceId, userId, key } },
    create: { workspaceId, userId, key },
    update: {},
  });
  return true;
}

/**
 * "Show them again" — every suggestion this person dismissed here. Only Elsie's own
 * keys: the Inbox's "What's new" dismissals share the table ("new:<id>",
 * lib/whats-new.ts) and are not suggestions, so they stay put.
 */
export async function restoreElsieSuggestions(workspaceId: string, userId: string): Promise<number> {
  const out = await db.elsieDismissal.deleteMany({ where: { workspaceId, userId, NOT: { key: { startsWith: "new:" } } } });
  return out.count;
}
