/**
 * The doc's review step, done by the app first: every caption is checked
 * against the house rules and anything off is FLAGGED for the person
 * reviewing — never silently "fixed". The doc ends every scenario with
 * "Review … make sure they aren't repetitive … check hashtags, length,
 * emojis and overall tone"; these are the parts of that a machine can check.
 */

export type CaptionItem = {
  item: string;
  header: string;
  body: string;
  hashtags: string[];
  /** The X (Twitter) version, ≤ 280 including hashtags. */
  x: string;
};

export type Flag = { code: string; text: string };

const EMOJI = /\p{Extended_Pictographic}/gu;
const BANNED_OPENINGS = [/^today,?\s+we\s+celebrate/i, /^today\s+is\s+/i, /^happy\s+\w+\s+day!?$/i];
const X_LIMIT = 280;

export function assemble(c: CaptionItem): string {
  return [c.header.trim(), c.body.trim(), c.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 3));
}
function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}
const opening = (s: string) => s.trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ");

export function checkBatch(items: CaptionItem[], previous: string[] = []): Flag[][] {
  const emojiUse = new Map<string, number>();
  for (const it of items) for (const e of new Set(assemble(it).match(EMOJI) ?? [])) emojiUse.set(e, (emojiUse.get(e) ?? 0) + 1);
  const openings = new Map<string, number>();
  for (const it of items) {
    const o = opening(it.body);
    if (o) openings.set(o, (openings.get(o) ?? 0) + 1);
  }

  return items.map((it, i) => {
    const flags: Flag[] = [];
    const text = assemble(it);
    if (it.hashtags.length !== 2 || it.hashtags.some((h) => !/^#[\p{L}\p{N}_]+$/u.test(h))) {
      flags.push({ code: "hashtags", text: `Needs exactly 2 hashtags — has ${it.hashtags.length}.` });
    }
    if (!it.header.trim()) flags.push({ code: "header", text: "No header or tagline." });
    const bodyLen = it.body.trim().length;
    if (bodyLen < 80) flags.push({ code: "short", text: `Short (${bodyLen} characters in the caption).` });
    if (bodyLen > 900) flags.push({ code: "long", text: `Long (${bodyLen} characters in the caption).` });
    if (BANNED_OPENINGS.some((re) => re.test(it.body.trim())) || BANNED_OPENINGS.some((re) => re.test(it.header.trim()))) {
      flags.push({ code: "opening", text: "Opens with “Today we celebrate…” or a similar stock opening." });
    }
    const o = opening(it.body);
    if (o && (openings.get(o) ?? 0) > 1) flags.push({ code: "repeat-opening", text: `Starts like another caption in this batch (“${o}…”).` });
    const emojis = text.match(EMOJI) ?? [];
    if (emojis.length > 3) flags.push({ code: "emoji", text: `${emojis.length} emojis — the house style is sparing.` });
    const reused = [...new Set(emojis)].filter((e) => (emojiUse.get(e) ?? 0) > 1);
    if (reused.length) flags.push({ code: "emoji-repeat", text: `Uses ${reused.join(" ")} like another caption in this batch.` });
    for (let j = 0; j < items.length; j++) {
      if (j !== i && similarity(it.body, items[j].body) >= 0.5) {
        flags.push({ code: "similar", text: `Close to ${items[j].item}'s wording.` });
        break;
      }
    }
    const prev = previous.find((p) => similarity(it.body, p) >= 0.45);
    if (prev) flags.push({ code: "copies-previous", text: `Close to a previous caption: “${prev.slice(0, 60)}…”` });
    if (it.x.length > X_LIMIT) flags.push({ code: "x-long", text: `The X version is ${it.x.length} characters — X allows ${X_LIMIT}; X will be left off this post.` });
    return flags;
  });
}

/** Parse the model's JSON reply into items; tolerant of fences, strict on shape. */
export function parseReply(content: string, expected: string[]): CaptionItem[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const clean = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return raw.slice(0, expected.length).map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const tags = Array.isArray(o.hashtags) ? o.hashtags.map((h) => clean(h, 60)).filter(Boolean) : [];
    return {
      // The label is ours, not the model's — order is the contract.
      item: expected[i],
      header: clean(o.header, 200),
      body: clean(o.body, 2000),
      hashtags: tags.map((h) => (h.startsWith("#") ? h : `#${h}`)).map((h) => h.replace(/\s+/g, "")),
      x: clean(o.x, 400),
    };
  });
}
