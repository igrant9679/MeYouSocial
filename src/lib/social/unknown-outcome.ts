/**
 * A social leg whose outcome we never learned: the request to Zernio timed
 * out, or the send was interrupted before Zernio answered. It may be live.
 * Retry warns for these rather than offering a blind re-send (audit SOC-12);
 * the older wording on rows from before 2026-10-27 ("aborted due to timeout")
 * counts too.
 */
export const MAY_HAVE_POSTED = "may have posted anyway";

export function mayHavePosted(error: string | null | undefined): boolean {
  return !!error && (error.includes(MAY_HAVE_POSTED) || /timed? ?out|aborted/i.test(error));
}
