/**
 * The parts of the team inbox (E-SOC-17) the reply box needs in the browser —
 * no database here, so the client bundle stays free of server code (the
 * bundle check enforces it). The server half is lib/inbox-team.ts.
 */

/** Meta's DM rule: a reply is accepted within 24 hours of the person's last message. */
export const REPLY_WINDOW_MS = 24 * 3_600_000;
/** Under this, the countdown turns amber. */
export const WINDOW_WARN_MS = 3 * 3_600_000;

/** When the reply window shuts, from their last message. Null when it doesn't apply or nothing came in. */
export function windowClosesAt(applies: boolean, lastInboundAt: Date | null): Date | null {
  if (!applies || !lastInboundAt) return null;
  return new Date(lastInboundAt.getTime() + REPLY_WINDOW_MS);
}

/** "5 h 12 m left" · "12 m left" · "closed". Pure. */
export function formatWindowLeft(closesAt: Date, now = new Date()): string {
  const ms = closesAt.getTime() - now.getTime();
  if (ms <= 0) return "closed";
  const mins = Math.max(1, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${m} m left` : `${m} m left`;
}

export type SavedReply = { id: string; name: string; body: string; category: string | null };

export const ASSIGNABLE_KINDS = ["conversation", "comment", "review"] as const;
export type AssignableKind = (typeof ASSIGNABLE_KINDS)[number];
export const isAssignableKind = (k: string): k is AssignableKind => (ASSIGNABLE_KINDS as readonly string[]).includes(k);

