/**
 * Evergreen controls (E-SOC-15), as pure rules the recycler and the Evergreen
 * library share — so the library's "next out" is the recycler's decision, not
 * a second guess at it.
 */

const DAY_MS = 86_400_000;
export const MAX_VARIANTS = 10;
export const VARIANT_MAX_CHARS = 5000;

/** The stored variants, cleaned: strings, trimmed, non-empty, bounded. */
export function parseVariants(json: string | null | undefined): string[] {
  try {
    const raw = JSON.parse(json ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, MAX_VARIANTS).map((v) => v.slice(0, VARIANT_MAX_CHARS))
      : [];
  } catch {
    return [];
  }
}

/** Variants typed into one box, separated by a line holding only "---". */
export function variantsFromText(text: string): string[] {
  return text.split(/\r?\n-{3,}\r?\n/).map((v) => v.trim()).filter(Boolean).slice(0, MAX_VARIANTS).map((v) => v.slice(0, VARIANT_MAX_CHARS));
}

/**
 * The text the next copy goes out with. The original and its variants take
 * turns, a variant first — the people who saw the original see something new
 * on the first recycle. No variants: always the original. `variant` is null
 * when it's the original (the copy keeps any per-network wording then).
 */
export function recycleText(original: string, variants: string[], timesRecycled: number): { text: string; variant: number | null } {
  if (!variants.length) return { text: original, variant: null };
  const turn = (timesRecycled + 1) % (variants.length + 1);
  return turn === 0 ? { text: original, variant: null } : { text: variants[turn - 1], variant: turn };
}

export type EvergreenSource = {
  status: string;
  evergreen: boolean;
  recycleEveryDays: number;
  recycleUntil: Date | null;
  maxRecycles: number | null;
  timesRecycled: number;
  lastRecycledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
};

export type EvergreenState =
  | { kind: "off" }
  | { kind: "not_sent" }
  | { kind: "finished"; max: number }
  | { kind: "ended"; until: Date }
  | { kind: "in_flight" }
  | { kind: "cooling"; until: Date }
  | { kind: "due" };

/** Where a source stands — the recycler's own tests, in its order. */
export function evergreenState(s: EvergreenSource, hasCopyInFlight: boolean, now = Date.now()): EvergreenState {
  if (!s.evergreen) return { kind: "off" };
  if (s.status !== "posted" && s.status !== "partial") return { kind: "not_sent" };
  if (s.maxRecycles != null && s.timesRecycled >= s.maxRecycles) return { kind: "finished", max: s.maxRecycles };
  if (s.recycleUntil && s.recycleUntil.getTime() <= now) return { kind: "ended", until: s.recycleUntil };
  if (hasCopyInFlight) return { kind: "in_flight" };
  const lastOut = (s.lastRecycledAt ?? s.publishedAt ?? s.createdAt).getTime();
  const ready = lastOut + Math.max(1, s.recycleEveryDays) * DAY_MS;
  return ready > now ? { kind: "cooling", until: new Date(ready) } : { kind: "due" };
}
