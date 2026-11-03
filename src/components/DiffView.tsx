import type { Row, Seg } from "@/lib/text-diff";

// The side-by-side diff for version pages (E-ART-03, E-VID-01): changed blocks
// with their words marked, unchanged runs folded. One copy, so the article and
// script pages read the same.

/** Unchanged stretches longer than four blocks fold to their ends. */
export function DiffRows({ rows }: { rows: Row[] }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "same") { out.push(<DiffRow key={i} row={rows[i]} />); i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === "same") j++;
    const run = rows.slice(i, j);
    if (run.length <= 4) run.forEach((r, k) => out.push(<DiffRow key={i + k} row={r} />));
    else {
      out.push(<DiffRow key={i} row={run[0]} />);
      out.push(
        <details key={`${i}-fold`} className="border-y border-[var(--line)] bg-[var(--zebra)]">
          <summary className="cursor-pointer select-none px-3 py-1 text-[11px] text-[var(--mute)]">{run.length - 2} unchanged blocks</summary>
          {run.slice(1, -1).map((r, k) => <DiffRow key={k} row={r} />)}
        </details>,
      );
      out.push(<DiffRow key={j - 1} row={run[run.length - 1]} />);
    }
    i = j;
  }
  return <div className="text-[13px] leading-relaxed">{out}</div>;
}

const ADD = { background: "var(--green-soft)", color: "var(--green-on)" };
const DEL = { background: "var(--rose-soft)", color: "var(--rose-on)", textDecoration: "line-through" };

function Cell({ tag, children, tone, label }: { tag: string; children: React.ReactNode; tone?: "add" | "del"; label?: string }) {
  const heading = /^h[1-6]$/.test(tag);
  return (
    <div className={`px-3 py-1.5 ${heading ? "font-semibold" : ""}`} style={tone === "add" ? { background: "var(--green-soft)" } : tone === "del" ? { background: "var(--rose-soft)" } : undefined}>
      {label && <span className="md:hidden block text-[10px] font-mono uppercase text-[var(--mute)]">{label}</span>}
      {tag === "li" && "• "}{children}
    </div>
  );
}

function Segs({ segs }: { segs: Seg[] }) {
  return <>{segs.map((s, i) => <span key={i}>{i > 0 && " "}{s.kind === "same" ? s.text : <mark style={s.kind === "add" ? ADD : DEL}>{s.text}</mark>}</span>)}</>;
}

function DiffRow({ row }: { row: Row }) {
  const pair = (left: React.ReactNode, right: React.ReactNode) => (
    <div className="grid grid-cols-1 md:grid-cols-2 border-b border-[var(--line)] last:border-0" data-diff-row={row.kind}>
      <div className="md:border-r border-[var(--line)] min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
  if (row.kind === "change") return pair(<Cell tag={row.tagA} label="Before"><Segs segs={row.left} /></Cell>, <Cell tag={row.tagB} label="After"><Segs segs={row.right} /></Cell>);
  if (row.kind === "del") return pair(<Cell tag={row.tag} tone="del" label="Removed">{row.text}</Cell>, <div className="hidden md:block" />);
  if (row.kind === "add") return pair(<div className="hidden md:block" />, <Cell tag={row.tag} tone="add" label="Added">{row.text}</Cell>);
  return pair(<Cell tag={row.tag}>{row.text}</Cell>, <div className="hidden md:block"><Cell tag={row.tag}>{row.text}</Cell></div>);
}
