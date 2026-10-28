/**
 * The engine's check-in, as words (E-ENG-03). No imports: the header pill is a
 * client component and reads these too — the reader and writer, which touch
 * the database, are in lib/engine-heartbeat.ts.
 */
export type Heartbeat = {
  /** When the cycle finished (ISO). */
  at: string;
  skipped?: "paused";
  budgetReached?: boolean;
  /** Things made, published or queued in the cycle. */
  activity: number;
  failed: number;
};

/** Sweeps run every 30 minutes by default; two hours without one is a fault, not a lull. */
export const SILENCE_MS = 2 * 60 * 60_000;

export function isSilent(hb: Heartbeat, now: number): boolean {
  return now - Date.parse(hb.at) > SILENCE_MS;
}

/** What the last cycle amounted to: "nothing was due", "paused, so it did nothing"… */
export function heartbeatNote(hb: Heartbeat): string {
  if (hb.skipped === "paused") return "paused, so it did nothing";
  if (hb.failed) return `${hb.failed} step${hb.failed === 1 ? "" : "s"} failed — see Automation`;
  const did = hb.activity ? `did ${hb.activity} thing${hb.activity === 1 ? "" : "s"}` : "nothing was due";
  return hb.budgetReached ? `${did}; today's AI allowance is used, so it only published and queued` : did;
}
