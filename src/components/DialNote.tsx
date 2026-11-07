import type { DialChange } from "@/lib/setting-history";
import { settingValueLabel } from "@/lib/setting-history";
import { formatZonedMoment } from "@/lib/zoned-dates";

/**
 * "Changed by Ada · 2 Nov, 04:38 — was off" under a dial (E-SET-05). Nothing
 * when no change has been recorded — dials set before 2026-11-02 have none.
 */
export function DialNote({ change, timeZone, fmt = settingValueLabel }: { change?: DialChange; timeZone: string; fmt?: (v: string | null) => string }) {
  if (!change) return null;
  return (
    <span className="block text-micro text-[var(--mute)] mt-0.5" data-dial-note>
      Changed by {change.by} · {formatZonedMoment(change.at, timeZone)}
      {change.hidden ? " (a secret — the value isn't kept)" : ` — was ${fmt(change.from)}`}
    </span>
  );
}
