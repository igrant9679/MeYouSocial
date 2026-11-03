/**
 * Anchored review comments (E-ART-15): the passage a comment quotes, and the
 * people it @mentions.
 *
 * A comment keeps the QUOTED TEXT, not an offset (FR-10), so an edit elsewhere
 * can't slide it onto another sentence. The price is that an edit to the
 * passage itself orphans the quote — `anchorPresent` says so, and the page
 * shows "no longer in the article" rather than pointing at the wrong words.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Whitespace collapsed and case folded — how a quote and the article's text are compared. */
export function normalizeQuote(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The article's readable text: tags (and script/style) out, entities decoded, each tag a word break. */
export function articleText(html: string): string {
  return normalizeQuote(decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")));
}

/** Is the quoted passage still in the article? A comment with no quote is about the whole piece, so it always is. */
export function anchorPresent(html: string | null | undefined, anchor: string | null | undefined): boolean {
  const q = normalizeQuote(anchor ?? "");
  if (!q) return true;
  return articleText(html ?? "").includes(q);
}

export type MentionMember = { userId: string; name: string | null; email: string | null };

/** What can follow "@" for a member: their full name, and the part of their email before the @. */
export function mentionHandles(m: MentionMember): string[] {
  const out = new Set<string>();
  const name = m.name?.trim().replace(/\s+/g, " ");
  if (name && name.length >= 2) out.add(name);
  const local = m.email?.split("@")[0]?.trim();
  if (local && local.length >= 2) out.add(local);
  return [...out];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = /[\p{L}\p{N}_]/u;

/**
 * The members a comment mentions: at each "@" that starts a word, the LONGEST
 * full name or email local part that follows it whole (case-insensitive), so
 * "@Sam Lee" is Sam Lee and not also a colleague called Sam. A name two
 * members share mentions both — a mention exists to tell someone, so a tie
 * errs on telling.
 */
export function parseMentions(body: string, members: MentionMember[]): string[] {
  const pairs = members.flatMap((m) => mentionHandles(m).map((h) => ({ id: m.userId, h: h.toLowerCase() })));
  const lower = body.toLowerCase();
  const ids = new Set<string>();
  for (let i = lower.indexOf("@"); i >= 0; i = lower.indexOf("@", i + 1)) {
    if (i > 0 && WORD.test(body[i - 1])) continue; // an email address, not a mention
    const rest = lower.slice(i + 1);
    const hits = pairs.filter((p) => rest.startsWith(p.h) && !WORD.test(rest[p.h.length] ?? ""));
    if (!hits.length) continue;
    const longest = Math.max(...hits.map((p) => p.h.length));
    for (const p of hits) if (p.h.length === longest) ids.add(p.id);
  }
  return [...ids];
}

/**
 * The comment's text cut into plain runs and mentions, for rendering — only the
 * handles of the people it was recorded as mentioning, longest first, so
 * "@Sam Lee" isn't read as "@Sam".
 */
export function mentionSegments(body: string, handles: string[]): Array<{ text: string; mention: boolean }> {
  const hs = [...new Set(handles.filter((h) => h.length >= 2))].sort((a, b) => b.length - a.length);
  if (!hs.length) return [{ text: body, mention: false }];
  const re = new RegExp(`@(?:${hs.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const out: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    // Only at the start or after a non-word character, as parseMentions reads it.
    if (i > 0 && /[\p{L}\p{N}_]/u.test(body[i - 1])) continue;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}
