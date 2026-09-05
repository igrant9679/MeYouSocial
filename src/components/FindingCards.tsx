import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addFindingToIdeasAction,
  answerFindingAction,
  applyFindingAction,
  dismissFindingAction,
  generateFindingsAction,
  weaveFindingAction,
} from "@/app/actions/blog-findings";
import type { FindingQuestion } from "@/lib/blog-findings";

/**
 * The recommendation card — Optimize → "Address these". One shape for every
 * finding, three treatments by kind:
 *   mechanical → the proposed addition shown as a diff, then Apply
 *   knowledge  → two or three questions; the answers become a proposal AND
 *                land in the Experts profile, so they are asked once
 *   strategic  → Add to ideas
 * Every card can be dismissed with a reason; a dismissed finding is not
 * re-raised for that article. Nothing touches the article until a verb is
 * pressed — Assist's rule, one level up. Server-rendered forms throughout.
 */

export type FindingRow = {
  id: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  proposal: string | null;
  anchor: string | null;
  questions: string;
  answers: string | null;
  status: string;
  reason: string | null;
};

const KIND_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  mechanical: { label: "Apply", bg: "var(--green-soft)", fg: "var(--green-on)" },
  knowledge: { label: "Answer", bg: "var(--amber-soft)", fg: "var(--amber-on)" },
  strategic: { label: "Idea", bg: "var(--violet-soft)", fg: "var(--violet-on)" },
};
const SOURCE_LABEL: Record<string, string> = {
  eeat: "E-E-A-T",
  content_gap: "Content gap",
  entity_coverage: "Entity coverage",
};

function parseQuestions(json: string): FindingQuestion[] {
  try { return JSON.parse(json) as FindingQuestion[]; } catch { return []; }
}

function Proposal({ html, anchor }: { html: string; anchor: string | null }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">
        Proposed addition{anchor ? <> · after “{anchor}”</> : <> · at the end</>}
      </div>
      {/* Escaped on purpose: this is a preview of what will be inserted, not a
          render of it — the author reads the markup they are approving. */}
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words rounded-lg p-2.5 overflow-x-auto" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
        {html.split("\n").map((line) => `+ ${line}`).join("\n")}
      </pre>
    </div>
  );
}

function DismissForm({ id }: { id: string }) {
  return (
    <form action={dismissFindingAction} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input name="reason" placeholder="why? (optional)" className="text-[11px] w-36" aria-label="Reason for dismissing" />
      <SubmitButton className="btn sm" pendingText="…">Dismiss</SubmitButton>
    </form>
  );
}

export function FindingCards({
  postId,
  findings,
  searchReal,
  canEdit,
}: {
  postId: string;
  findings: FindingRow[];
  searchReal: boolean;
  canEdit: boolean;
}) {
  const open = findings.filter((f) => f.status === "open" || f.status === "answered");
  const done = findings.filter((f) => f.status !== "open" && f.status !== "answered");
  const order = { knowledge: 0, mechanical: 1, strategic: 2 } as Record<string, number>;
  open.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {canEdit && (
          <form action={generateFindingsAction}>
            <input type="hidden" name="postId" value={postId} />
            <SubmitButton className="btn primary" pendingText="Reviewing…">
              {findings.length ? "Look again" : "Find what to improve"}
            </SubmitButton>
          </form>
        )}
        <span className="text-xs text-[var(--mute)]">
          E-E-A-T, entity coverage and content gaps, as cards you can act on.
          {!searchReal && (
            <> Content gaps need real search data — add a Tavily or Serper key under <Link href="/admin/api-keys" className="underline">Admin → API keys</Link>.</>
          )}
        </span>
      </div>

      {findings.length === 0 && (
        <p className="text-xs text-[var(--mute)]">Nothing reviewed yet. Findings you dismiss won&apos;t come back for this article.</p>
      )}

      {open.length > 0 && (
        <ul className="flex flex-col gap-2 m-0 p-0">
          {open.map((f) => {
            const style = KIND_STYLE[f.kind] ?? KIND_STYLE.mechanical;
            const questions = parseQuestions(f.questions);
            return (
              <li key={f.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: style.bg, color: style.fg }}>
                    {f.kind}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--mute)]">{SOURCE_LABEL[f.source] ?? f.source}</span>
                  {f.status === "answered" && <span className="font-mono text-[10px] text-[var(--mute)]">· answered</span>}
                </div>
                <div className="text-sm font-semibold leading-snug">{f.title}</div>
                {f.detail && <p className="text-xs text-[var(--mute)] mt-0.5 mb-0">{f.detail}</p>}

                {/* knowledge, unanswered: the interview */}
                {f.kind === "knowledge" && f.status === "open" && canEdit && (
                  <form action={answerFindingAction} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="id" value={f.id} />
                    {questions.map((q, i) => (
                      <label key={i} className="text-xs flex flex-col gap-1">
                        <span>{q.q}</span>
                        <textarea name={`a${i}`} rows={2} className="w-full text-sm" placeholder="In your own words — only what you can stand behind if quoted." />
                      </label>
                    ))}
                    <div className="flex items-center gap-2 flex-wrap">
                      <SubmitButton className="btn primary sm" pendingText="Saving and writing…">Answer</SubmitButton>
                      <span className="text-[10px] text-[var(--mute)]">Your answers are saved to the Experts profile, so you&apos;re asked once.</span>
                      <span className="flex-1" />
                      <DismissForm id={f.id} />
                    </div>
                  </form>
                )}

                {/* knowledge, answered: the woven proposal, or a retry */}
                {f.kind === "knowledge" && f.status === "answered" && (
                  <div className="mt-1">
                    {f.proposal ? (
                      <Proposal html={f.proposal} anchor={f.anchor} />
                    ) : (
                      <p className="text-xs mt-1" style={{ color: "var(--amber-on)" }}>{f.reason ?? "Answers saved."}</p>
                    )}
                    {canEdit && (
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        {f.proposal ? (
                          <form action={applyFindingAction}>
                            <input type="hidden" name="id" value={f.id} />
                            <SubmitButton className="btn primary sm" pendingText="Applying…">Apply</SubmitButton>
                          </form>
                        ) : (
                          <form action={weaveFindingAction}>
                            <input type="hidden" name="id" value={f.id} />
                            <SubmitButton className="btn sm" pendingText="Writing…">Weave again</SubmitButton>
                          </form>
                        )}
                        <span className="flex-1" />
                        <DismissForm id={f.id} />
                      </div>
                    )}
                  </div>
                )}

                {/* mechanical: diff then Apply */}
                {f.kind === "mechanical" && f.proposal && (
                  <div>
                    <Proposal html={f.proposal} anchor={f.anchor} />
                    {canEdit && (
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <form action={applyFindingAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <SubmitButton className="btn primary sm" pendingText="Applying…">Apply</SubmitButton>
                        </form>
                        <span className="flex-1" />
                        <DismissForm id={f.id} />
                      </div>
                    )}
                  </div>
                )}

                {/* strategic: a decision, not an edit */}
                {f.kind === "strategic" && canEdit && (
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <form action={addFindingToIdeasAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <SubmitButton className="btn primary sm" pendingText="Adding…">Add to ideas</SubmitButton>
                    </form>
                    <span className="text-[10px] text-[var(--mute)]">Lands on Blog → Ideas as discovered.</span>
                    <span className="flex-1" />
                    <DismissForm id={f.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-[var(--mute)] cursor-pointer">{done.length} addressed</summary>
          <ul className="text-xs text-[var(--mute)] mt-1 flex flex-col gap-0.5">
            {done.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{f.status}</span> — {f.title}
                {f.status === "dismissed" && f.reason ? <span> ({f.reason})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
