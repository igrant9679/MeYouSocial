import { Bot, AlertTriangle } from "lucide-react";
import { readStamp } from "@/lib/provenance";
import { formatDay } from "@/lib/zoned-dates";

/**
 * The provenance chip on a generated block (E-VID-13): the model that wrote
 * it, or "Mock — AI unavailable" in amber when the mock did. No stamp, no chip.
 * `what` names the block in the tooltip ("outline", "script", "report").
 */
export function ProvenanceChip({ stamp, what, timeZone }: { stamp: string | null | undefined; what: string; timeZone?: string }) {
  const p = readStamp(stamp);
  if (!p) return null;
  const when = formatDay(p.at, timeZone);
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={p.mock ? { background: "var(--amber-soft)", color: "var(--amber-on)" } : { background: "var(--zebra)", color: "var(--mute)" }}
      title={p.mock ? `This ${what}'s last AI pass (${when}) came from the placeholder model, not a real one — treat it as a stand-in.` : `This ${what}'s last AI pass was ${p.label}, ${when}. Edits since then are people's.`}
      data-provenance={p.mock ? "mock" : p.provider}
    >
      {p.mock ? <AlertTriangle className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      {p.label}
    </span>
  );
}
