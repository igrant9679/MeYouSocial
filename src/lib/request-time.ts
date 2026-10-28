/**
 * "Now" for a server component's render. A server render runs once per
 * request, so reading the clock there is stable for that request — but the
 * React Compiler's purity rule can't tell a server component from a client one
 * and flags a bare Date.now() in either (PRF-04). Client components keep their
 * clock in state instead (SocialCalendar's useMinuteClock).
 */
export function requestNow(): number {
  return Date.now();
}

/** The instant `days` days before this request. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
