import { levelOf, readabilityReport, TARGETS, type Flag } from "@/lib/readability";

// Optimize → Readability coaching (E-ART-11): each section scored against the
// article's target reading level, with the sentences and paragraphs that pull
// it down, the problem part highlighted. Advisory — it never holds a publish.

const KIND: Record<Flag["kind"], string> = {
  long_sentence: "Long sentence",
  passive: "Passive voice",
  long_paragraph: "Long paragraph",
};

function Highlighted({ flag }: { flag: Flag }) {
  if (flag.kind !== "passive" || !flag.mark) return <>{flag.text}</>;
  const i = flag.text.toLowerCase().indexOf(flag.mark.toLowerCase());
  if (i < 0) return <>{flag.text}</>;
  return <>{flag.text.slice(0, i)}<mark className="rounded px-0.5" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>{flag.text.slice(i, i + flag.mark.length)}</mark>{flag.text.slice(i + flag.mark.length)}</>;
}

export function ReadabilityCoach({ body, readingLevel }: { body: string | null; readingLevel: string | null }) {
  const level = levelOf(readingLevel);
  const t = TARGETS[level];
  const report = readabilityReport(body, level);
  if (!report.length) return null;
  const flagged = report.reduce((n, s) => n + s.flags.length, 0);
  return (
    <div className="card mt-4" data-readability-coach>
      <h2 className="text-sm font-semibold mb-0.5">Readability coaching</h2>
      <p className="text-xs text-[var(--mute)] mt-0 mb-3">
        Target: <b>{t.label}</b>{readingLevel ? "" : " (no level set — change it under Write)"} — a reading-ease score of {t.flesch}+, sentences under {t.sentence} words,
        paragraphs under {t.paragraph}. Passive voice is found by pattern, so it can miss some and catch the odd false one.
        {flagged === 0 ? " Nothing to change." : ` ${flagged} thing${flagged === 1 ? "" : "s"} to look at.`}
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {report.map((s, i) => (
          <li key={i} className="border-t border-[var(--line)] pt-2" data-readability-section={s.heading} data-readability-ok={s.ok == null ? "unscored" : s.ok ? "yes" : "no"}>
            {/* Open where there's something to look at; a clean section stays folded. */}
            <details open={s.ok === false || s.flags.length > 0}>
              <summary className="cursor-pointer text-xs flex flex-wrap items-center gap-2 list-none">
                <span className="font-semibold flex-1 min-w-40">{s.heading}</span>
                <span className="font-mono text-micro text-[var(--mute)]">{s.words} words</span>
                <span
                  className="font-mono text-micro px-1.5 py-0.5 rounded-full"
                  style={s.ok == null ? { background: "var(--zebra)", color: "var(--mute)" } : s.ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--amber-soft)", color: "var(--amber-on)" }}
                  title="Flesch reading ease — higher is easier"
                >
                  {s.flesch == null ? "too short to score" : `ease ${s.flesch} / ${s.target}`}
                </span>
                {s.flags.length > 0 && <span className="font-mono text-micro" style={{ color: "var(--amber-on)" }}>{s.flags.length} flagged</span>}
              </summary>
              {s.flags.length > 0 && (
                <ul className="m-0 mt-1.5 pl-0 list-none flex flex-col gap-1">
                  {s.flags.map((f, j) => (
                    <li key={j} className="text-xs leading-snug" data-readability-flag={f.kind}>
                      <span className="font-mono text-micro uppercase tracking-wide mr-1.5" style={{ color: "var(--amber-on)" }}>
                        {KIND[f.kind]}{f.kind !== "passive" ? ` · ${f.words} words` : ""}
                      </span>
                      <span className="text-[var(--mute)]"><Highlighted flag={f} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
