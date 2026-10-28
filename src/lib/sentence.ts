/**
 * The full stop after a name, unless the name already ends a sentence —
 * "CommunityForce Inc." read "…in CommunityForce Inc.." on eight pages (SET-14).
 */
export function stop(name: string): string {
  return /[.!?…]$/.test(name.trim()) ? "" : ".";
}
