/**
 * What Zernio's answer says about one leg of a post, and what a post's legs
 * say about the post. No database here, so the send, the webhook, the
 * reconcile pass and a test all read the same rules.
 *
 * ⚠ A status that is neither "it's out" nor "it failed" means Zernio is STILL
 * SENDING — Instagram answers "processing" while it takes in the picture.
 * Until 2026-11-23 the send recorded that as a failure and dropped the Zernio
 * post's id, so nothing could correct it later and Retry would have posted it
 * a second time (LSI Media, 19 Nov). In flight is its own outcome: the leg
 * stays pending WITH the id, and the post stays "publishing" until Zernio says
 * which way it went.
 */

/** Zernio's words for a leg that is out. */
export const ZERNIO_POSTED: ReadonlySet<string> = new Set(["published"]);
/** Zernio's words for a leg that will not go out. */
export const ZERNIO_FAILED: ReadonlySet<string> = new Set(["failed", "error", "cancelled", "rejected"]);

export type LegOutcome = "posted" | "failed" | "in_flight";

/**
 * A leg in the answer to the send itself. "publishing" counts as out here, as
 * it always has; a named failure or an error message is a failure; anything
 * else — "processing", "pending", a word Zernio adds later — is in flight.
 */
export function sendOutcome(leg: { status: string; error: string | null }): LegOutcome {
  if (leg.status === "published" || leg.status === "publishing") return "posted";
  if (ZERNIO_FAILED.has(leg.status) || leg.error) return "failed";
  return "in_flight";
}

/** The note a leg carries while Zernio is still sending it. Not an error. */
export function inFlightNote(zernioStatus: string): string {
  return `Zernio is still sending this one (it said “${zernioStatus}”). It will be marked posted or failed when Zernio reports which.`;
}

/** A leg Zernio is still sending: pending, and holding the Zernio post's id. */
export function isInFlight(leg: { status: string; providerPostId: string | null }): boolean {
  return leg.status === "pending" && !!leg.providerPostId;
}

export type PostRollUp = "posted" | "publishing" | "partial" | "failed";

/**
 * A post's status from its legs. ⚠ A pending leg is in flight, not a failure,
 * and it outranks "partial": while any leg is unsettled the post is still
 * "publishing" — the state the reconcile pass reads, and one Retry can't claim.
 */
export function rollUpPostStatus(legs: { status: string }[]): PostRollUp {
  const posted = legs.filter((t) => t.status === "posted").length;
  if (legs.length > 0 && posted === legs.length) return "posted";
  if (legs.some((t) => t.status === "pending")) return "publishing";
  return posted > 0 ? "partial" : "failed";
}

/** How the reason on a wrongly-failed in-flight leg began, before 2026-11-23. */
export const LEGACY_IN_FLIGHT_PREFIX = "Zernio reported status “";
const LEGACY_IN_FLIGHT = /^Zernio reported status “([^”]*)”$/;

/**
 * The Zernio status inside a reason the old send wrote for a leg that was in
 * flight, or null when the reason is anything else — including a real failure
 * ("Zernio reported status “failed”").
 */
export function legacyInFlightStatus(error: string | null | undefined): string | null {
  const m = LEGACY_IN_FLIGHT.exec(error ?? "");
  if (!m) return null;
  return sendOutcome({ status: m[1], error: null }) === "in_flight" ? m[1] : null;
}

/** The exact reasons that DO name a failure — kept out of the repair's query. */
export const LEGACY_SETTLED_REASONS: string[] = [...ZERNIO_FAILED].map((s) => `${LEGACY_IN_FLIGHT_PREFIX}${s}”`);
