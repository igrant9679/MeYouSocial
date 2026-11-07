import type { CellTuning, Yield } from "@/lib/idea-yield";
import { PER_CELL } from "@/lib/ideation";

// How ideas fared and what discovery asks for next (E-IDE-19) — the Topics
// list and a Topic's own page show the same figures from lib/idea-yield.ts.

export function YieldFigures({ y }: { y: Yield }) {
  const pct = (r: number | null) => `${Math.round((r ?? 0) * 100)}%`;
  return (
    <span className="font-mono text-2xs text-[var(--mute)] flex flex-wrap gap-x-3">
      <span><b className="text-[var(--ink)] tabular-nums">{y.ideas}</b> idea{y.ideas === 1 ? "" : "s"}</span>
      {y.decided ? (
        <span title={`${y.approved} approved, ${y.rejected} rejected`}><b className="text-[var(--ink)] tabular-nums">{pct(y.approvalRate)}</b> approved of {y.decided} decided</span>
      ) : (
        <span>none decided yet</span>
      )}
      <span title="Of those approved, published or sent"><b className="text-[var(--ink)] tabular-nums">{y.published}</b> out{y.approved ? ` of ${y.approved}` : ""}</span>
    </span>
  );
}

/** What this Topic's next discovery run asks for, and why (E-IDE-19). Formats the workspace discovers in only. */
export function TuningLines({ tuning, id }: { tuning: { article: CellTuning; social: CellTuning }; id: string }) {
  const lines = (["article", "social"] as const).filter((f) => tuning[f].baseline.ideas > 0);
  if (lines.length === 0) return null;
  return (
    <div className="text-2xs text-[var(--mute)] mb-2 flex flex-col gap-0.5" data-topic-tuning={id}>
      {lines.map((f) => {
        const tu = tuning[f];
        return (
          <p key={f} className="m-0" data-tuning-format={f} data-tuning-count={tu.count}>
            <span className="text-[var(--slate)]">{f === "article" ? "Article" : "Social"} discovery here:</span>{" "}
            next run asks for <b className="text-[var(--ink)]">{tu.count}</b>{tu.count !== PER_CELL ? ` (usually ${PER_CELL})` : ""} — {tu.reason}.
          </p>
        );
      })}
    </div>
  );
}
