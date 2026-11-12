import type { Signal } from "@/lib/reach";

/**
 * ⚠ IDEAS LISTEN BEFORE THEY'RE WRITTEN (Reach). One listening pass — Reddit
 * threads, public social posts and the web, taken in turns — on what an idea run
 * is about, handed to the model as numbered, fenced quotes; each idea names the
 * numbers it answers, and only LISTED numbers are kept as its evidence. Shared by
 * every discovery path: articles (blog-autopilot, part da), social posts
 * (social/ideation) and videos (the onboarding.ideas job) since part dc.
 *
 * `ideas:listen` "off" (Settings → Keys → Live sources) turns it off for all of
 * them. A source that can't be reached is just absent — discovery never waits
 * on it and never fails over it.
 */

/** How many heard items a prompt gets — listen() takes channels in turns, so these hold some of each. */
export const HEARD_MAX = 10;

export type Heard = { signals: Signal[]; notes: string[] };

export async function listenForIdeas(workspaceId: string, subject: string): Promise<Heard> {
  const s = subject.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!s) return { signals: [], notes: [] };
  const { getSetting } = await import("@/lib/settings");
  if ((await getSetting("ideas:listen", workspaceId).catch(() => "")) === "off") return { signals: [], notes: [] };
  const { listen } = await import("@/lib/reach");
  const heard = await listen(workspaceId, s, { perSource: 4, freshDays: 120 }).catch(() => ({ signals: [] as Signal[], notes: ["listening failed"] }));
  return { signals: heard.signals.slice(0, HEARD_MAX), notes: heard.notes };
}

/** The prompt's block of heard items, fenced as quoted material — or null when nothing was heard. */
export async function heardBlock(signals: Signal[]): Promise<string | null> {
  if (!signals.length) return null;
  const { quoteForPrompt, sourceLabel } = await import("@/lib/reach");
  return `What people are discussing now (numbered — cite them in sources):\n${signals
    .map((s) => `[${s.n}] (${sourceLabel(s.source, s.url)}) ${s.title}\n${s.url}\n${quoteForPrompt(`discussion ${s.n}`, s.snippet, 500)}`)
    .join("\n")}`;
}

/** The system prompt's sentence about `sources`, with the quoted-material rule when anything was heard. */
export async function sourcesRule(heard: boolean): Promise<string> {
  if (!heard) return 'Return "sources": [] for every idea.';
  const { QUOTED_MATERIAL_RULE } = await import("@/lib/reach");
  return "When the numbered discussions supplied show a real question, complaint or disagreement an idea answers, say so in the angle and list those numbers in sources; an idea none of them supports gets sources []. Never cite a number that isn't listed. " + QUOTED_MATERIAL_RULE;
}

/** The idea's evidence: only numbers that were listed, at most five, as stored JSON — or null. */
export function evidenceFor(sources: unknown, signals: Signal[]): string | null {
  const nums = Array.isArray(sources) ? [...new Set(sources.map(Number).filter((n) => Number.isInteger(n)))] : [];
  const picked = nums.map((n) => signals.find((s) => s.n === n)).filter((s): s is Signal => !!s).slice(0, 5);
  return picked.length ? JSON.stringify(picked.map((s) => ({ title: s.title.slice(0, 200), url: s.url.slice(0, 1000), source: s.source }))) : null;
}
