import Link from "next/link";

/**
 * The stage-page skeleton (One-Loop redesign, step 3). Every stage shares it
 * so learning one teaches all seven: a header with counts by state, the
 * stage's own item rows, and the Ask drawer. The tab strip of the module pages
 * inside the stage is NOT here — it is the persistent StageStrip in the app
 * shell, so it stays while you are inside a tab.
 *
 * Ask is a plain form into the assistant: a message with no thread id starts
 * one and lands on its transcript. It reads and drafts; it cannot publish,
 * send, schedule, approve or delete — the allowlist in lib/assistant/tools.ts
 * is the safety model, and a docked box on every stage doesn't change it.
 */

export type StageCount = { label: string; n: number | null; href?: string; hue?: string };

export function StageHeader({
  title,
  sentence,
  counts,
}: {
  title: string;
  sentence: string;
  counts: StageCount[];
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="font-mono text-[22px] font-bold m-0">{title}</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">{sentence}</p>
      </div>
      {counts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {counts.map((c) => {
            const hue = c.hue ?? "zebra";
            const chip = (
              <span
                className="font-mono text-[11px] px-2 py-0.5 rounded-full"
                style={hue === "zebra" ? { background: "var(--zebra)", color: "var(--mute)" } : { background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                title={c.n === null ? "not measured" : undefined}
              >
                <b className="tabular-nums">{c.n === null ? "—" : c.n}</b> {c.label}
              </span>
            );
            return c.href ? <Link key={c.label} href={c.href} className="hover:underline">{chip}</Link> : <span key={c.label}>{chip}</span>;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A row of items in a stage.
 *
 * ⚠ `empty` was typed `string`, which made a button structurally impossible —
 * so all five stage overviews inherited an empty state with nowhere to go
 * (audit B6). Widening it to ReactNode lets a caller pass an <EmptyState/>;
 * every existing string caller keeps working unchanged.
 */
export function StageList({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <section className="card mb-4">
      <h2 className="font-mono text-[13px] font-bold mb-2">{title}</h2>
      {children ? (
        <ul className="m-0 p-0 flex flex-col">{children}</ul>
      ) : typeof empty === "string" ? (
        <p className="text-xs text-[var(--mute)] m-0">{empty}</p>
      ) : (
        empty
      )}
    </section>
  );
}

export function StageRow({ children }: { children: React.ReactNode }) {
  return <li className="border-t border-[var(--line)] first:border-t-0 py-2.5 flex items-center gap-3 flex-wrap">{children}</li>;
}

export function StateChip({ label, hue }: { label: string; hue: string }) {
  return (
    <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
      {label}
    </span>
  );
}

// ⚠ AskDrawer lived here and sat at the bottom of all seven stage pages, a
// third "Ask" on a screen that already had the header button and the floating
// dock pill — each with different placeholder copy (audit B1.5). It also told
// people the assistant "can't publish, send, schedule, approve or delete",
// which stopped being true on 2026-09-08. The dock is the assistant now:
// Ctrl+/ anywhere, one conversation that follows you between pages.
