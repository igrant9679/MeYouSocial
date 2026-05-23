import Link from "next/link";
import { ArrowLeft, Search, Layers, Type, Image as ImageIcon, Zap, Target, FileText, Edit3, Download, Send, ListChecks, Check, RefreshCw } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { CopyButton } from "@/components/CopyButton";
import {
  setBuilderStepAction,
  setBuilderResearchDepthAction,
  addBuilderResearchItemAction,
  setBuilderFrameAction,
  suggestBuilderTitlesAction,
  pickBuilderTitleAction,
  suggestBuilderHooksAction,
  pickBuilderHookAction,
  setBuilderPayoffsAction,
  generateBuilderDraftAction,
  regenerateBuilderSectionAction,
  generateBuilderPublishAction,
} from "@/app/actions/builder";
import { RESEARCH_DEPTHS } from "@/lib/canvas/builder-const";

// MU-05 — Script Builder Classic. 10-step alternative to Canvas (FR-SB-01..12).

const STEPS = [
  { n: 1,  label: "Research",  icon: Search },
  { n: 2,  label: "Frame",     icon: Layers },
  { n: 3,  label: "Title",     icon: Type },
  { n: 4,  label: "Thumbnail", icon: ImageIcon },
  { n: 5,  label: "Hook",      icon: Zap },
  { n: 6,  label: "Payoffs",   icon: Target },
  { n: 7,  label: "Draft",     icon: FileText },
  { n: 8,  label: "Edit",      icon: Edit3 },
  { n: 9,  label: "Export",    icon: Download },
  { n: 10, label: "Publish",   icon: Send },
];

type BuilderState = {
  step: number;
  research: { depth: keyof typeof RESEARCH_DEPTHS; items: { kind: string; ref: string; words: number; title?: string }[] };
  frame: { framework?: string; angle?: string; learningGoal?: string; emotionalGoal?: string };
  title: string;
  titleVariants: string[];
  thumbnailId?: string;
  hook: string;
  hookVariants: string[];
  payoffs: string[];
  sections: { title: string; content: string }[];
  publish?: { description?: string; tags?: string; metadata?: string };
};

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: { channel: true, template: true, thumbnails: { take: 4, orderBy: { createdAt: "desc" } } },
  });
  if (!script) notFound();

  const state: BuilderState = readJson<BuilderState>(script.builderSteps ?? null, {
    step: 1,
    research: { depth: "intermediate", items: [] },
    frame: {},
    title: script.title,
    titleVariants: [],
    hook: "",
    hookVariants: [],
    payoffs: [],
    sections: [],
  });

  const completedThrough = (() => {
    let n = 0;
    if (state.research.items.length > 0) n = 1;
    if (state.frame.framework || state.frame.angle) n = Math.max(n, 2);
    if (state.title) n = Math.max(n, 3);
    if (state.thumbnailId || script.thumbnails.length > 0) n = Math.max(n, 4);
    if (state.hook) n = Math.max(n, 5);
    if (state.payoffs.length > 0) n = Math.max(n, 6);
    if (state.sections.length > 0) n = Math.max(n, 7);
    if (script.body) n = Math.max(n, 8);
    return n;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
      {/* Step sidebar */}
      <aside className="card p-3 h-fit lg:sticky lg:top-4">
        <Link href={`/scripts/${id}`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Canvas mode</Link>
        <ul className="m-0 p-0 flex flex-col gap-1">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const isActive = state.step === s.n;
            const isDone = completedThrough >= s.n;
            return (
              <li key={s.n}>
                <form action={setBuilderStepAction}>
                  <input type="hidden" name="scriptId" value={id} />
                  <input type="hidden" name="step" value={s.n} />
                  <button type="submit" className={"w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition " + (isActive ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--mute)] hover:bg-[var(--zebra)]")}>
                    <span className="w-5 h-5 rounded-md grid place-items-center" style={{ background: isDone ? "var(--green-soft)" : "var(--zebra)", color: isDone ? "var(--green)" : "var(--mute)" }}>
                      {isDone ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                    </span>
                    <span className="text-left flex-1">{s.n}. {s.label}</span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Step content */}
      <main className="card">
        <h1 className="font-mono font-bold text-xl mb-4 flex items-center gap-2">
          Step {state.step} — {STEPS[state.step - 1].label}
        </h1>
        {state.step === 1  && <StepResearch scriptId={id} state={state} />}
        {state.step === 2  && <StepFrame scriptId={id} state={state} />}
        {state.step === 3  && <StepTitle scriptId={id} state={state} fallback={script.title} />}
        {state.step === 4  && <StepThumbnail scriptId={id} thumbnails={script.thumbnails} />}
        {state.step === 5  && <StepHook scriptId={id} state={state} />}
        {state.step === 6  && <StepPayoffs scriptId={id} state={state} />}
        {state.step === 7  && <StepDraft scriptId={id} state={state} />}
        {state.step === 8  && <StepEdit scriptId={id} />}
        {state.step === 9  && <StepExport scriptId={id} body={script.body ?? ""} />}
        {state.step === 10 && <StepPublish scriptId={id} state={state} />}

        {/* Continue */}
        <form action={setBuilderStepAction} className="mt-6 flex justify-end">
          <input type="hidden" name="scriptId" value={id} />
          <input type="hidden" name="step" value={Math.min(10, state.step + 1)} />
          {state.step < 10 && <button type="submit" className="btn primary">Continue →</button>}
        </form>
      </main>
    </div>
  );
}

// ── Step 1 — Research ───────────────────────────────────────────────────
function StepResearch({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--mute)]">Attach research and pick a depth. Research depth caps how much external context the AI consults during the draft.</p>

      <form action={setBuilderResearchDepthAction} className="card">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2">Research depth (FR-RES-03)</h3>
        <input type="hidden" name="scriptId" value={scriptId} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(RESEARCH_DEPTHS).map(([k, v]) => (
            <label key={k} className={"border rounded-lg p-2.5 cursor-pointer text-center " + (state.research.depth === k ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]")}>
              <input type="radio" name="depth" value={k} defaultChecked={state.research.depth === k} className="hidden" />
              <div className="text-sm font-semibold">{v.label}</div>
              <div className="text-[10px] font-mono text-[var(--mute)]">{v.words.toLocaleString()} word budget</div>
            </label>
          ))}
        </div>
        <div className="flex justify-end mt-2">
          <button type="submit" className="btn sm">Save depth</button>
        </div>
      </form>

      <form action={addBuilderResearchItemAction} className="card">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2">Add a research item</h3>
        <input type="hidden" name="scriptId" value={scriptId} />
        <div className="flex flex-wrap gap-2 items-end">
          <select name="kind" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="youtube">YouTube</option>
            <option value="web">Web URL</option>
            <option value="text">Pasted text</option>
            <option value="pdf">PDF (uploaded)</option>
          </select>
          <input name="title" placeholder="Title (optional)" className="border border-[var(--line-2)] rounded-lg p-2 text-sm flex-1 min-w-[180px]" />
          <input name="ref" required placeholder="URL or paste" className="border border-[var(--line-2)] rounded-lg p-2 text-sm flex-1 min-w-[200px] font-mono" />
          <button type="submit" className="btn primary sm">Add</button>
        </div>
      </form>

      <ul className="m-0 p-0">
        {state.research.items.map((r, i) => (
          <li key={i} className="border-t border-[var(--line)] py-2 text-sm flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{r.kind}</span>
            <span className="flex-1 truncate">{r.title ?? r.ref}</span>
            <span className="text-[11px] text-[var(--mute)]">{r.words}w</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Step 2 — Frame ──────────────────────────────────────────────────────
function StepFrame({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <form action={setBuilderFrameAction} className="flex flex-col gap-3 max-w-2xl">
      <input type="hidden" name="scriptId" value={scriptId} />
      <p className="text-sm text-[var(--mute)]">Choose a narrative framework, define your specific angle, and set goals.</p>
      <FormField name="framework" label="Narrative framework" defaultValue={state.frame.framework} placeholder="e.g. WHY-WHAT-HOW, 3-act, P-A-S, listicle" />
      <FormField name="angle" label="Specific angle" defaultValue={state.frame.angle} placeholder="What's the single most counter-intuitive take?" />
      <FormField name="learningGoal" label="Learning goal" defaultValue={state.frame.learningGoal} placeholder="By the end the viewer should understand…" />
      <FormField name="emotionalGoal" label="Emotional goal" defaultValue={state.frame.emotionalGoal} placeholder="The viewer should feel…" />
      <div className="flex justify-end"><button type="submit" className="btn primary sm">Save frame</button></div>
    </form>
  );
}
function FormField({ name, label, defaultValue, placeholder }: { name: string; label: string; defaultValue?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
    </label>
  );
}

// ── Step 3 — Title ──────────────────────────────────────────────────────
function StepTitle({ scriptId, state, fallback }: { scriptId: string; state: BuilderState; fallback: string }) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[var(--mute)]">Pick a title (FR-SB-04). Generate variants or write your own.</p>

      <form action={pickBuilderTitleAction} className="card flex flex-col gap-2">
        <input type="hidden" name="scriptId" value={scriptId} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Working title</span>
          <input name="title" defaultValue={state.title || fallback} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-semibold" required />
        </label>
        <div className="flex justify-end"><button type="submit" className="btn primary sm">Save title</button></div>
      </form>

      <form action={suggestBuilderTitlesAction} className="flex justify-between items-center">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)]">AI suggestions</h3>
        <input type="hidden" name="scriptId" value={scriptId} />
        <button type="submit" className="btn sm">Suggest titles</button>
      </form>

      {state.titleVariants.length > 0 && (
        <ul className="m-0 p-0">
          {state.titleVariants.map((t, i) => (
            <li key={i} className="border-t border-[var(--line)] py-2 flex items-center gap-2 text-sm">
              <span className="flex-1">{t}</span>
              <form action={pickBuilderTitleAction}>
                <input type="hidden" name="scriptId" value={scriptId} />
                <input type="hidden" name="title" value={t} />
                <button type="submit" className="btn sm">Use</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Step 4 — Thumbnail ──────────────────────────────────────────────────
function StepThumbnail({ scriptId: _, thumbnails }: { scriptId: string; thumbnails: { id: string; title: string | null; renderUrl: string | null; concepts: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--mute)]">Build a thumbnail in the Thumbnail Studio, then come back. (FR-SB-05 / FR-THUMB)</p>
      <Link href="/thumbnails" className="btn primary sm w-fit">Open Thumbnail Studio →</Link>
      {thumbnails.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          {thumbnails.map((t) => {
            const concepts = readJson<{ url: string }[]>(t.concepts, []);
            const url = t.renderUrl ?? concepts[0]?.url;
            return (
              <div key={t.id} className="border border-[var(--line)] rounded-lg overflow-hidden">
                {url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={t.title ?? ""} className="w-full aspect-video object-cover" />)}
                <div className="p-2 text-xs">{t.title ?? "Untitled"}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 5 — Hook ───────────────────────────────────────────────────────
function StepHook({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[var(--mute)]">Pick an opening hook that delivers on the title (FR-SB-06).</p>

      <form action={pickBuilderHookAction} className="card flex flex-col gap-2">
        <input type="hidden" name="scriptId" value={scriptId} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Selected hook</span>
          <textarea name="hook" defaultValue={state.hook} rows={3} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" required />
        </label>
        <div className="flex justify-end"><button type="submit" className="btn primary sm">Save hook</button></div>
      </form>

      <form action={suggestBuilderHooksAction} className="flex justify-between items-center">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)]">AI suggestions</h3>
        <input type="hidden" name="scriptId" value={scriptId} />
        <button type="submit" className="btn sm">Suggest hooks</button>
      </form>

      {state.hookVariants.length > 0 && (
        <ul className="m-0 p-0 flex flex-col gap-2">
          {state.hookVariants.map((h, i) => (
            <li key={i} className="border border-[var(--line)] rounded-lg p-3 flex items-start gap-2 text-sm">
              <span className="flex-1 whitespace-pre-wrap">{h}</span>
              <form action={pickBuilderHookAction}>
                <input type="hidden" name="scriptId" value={scriptId} />
                <input type="hidden" name="hook" value={h} />
                <button type="submit" className="btn sm">Use</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Step 6 — Payoffs ────────────────────────────────────────────────────
function StepPayoffs({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <form action={setBuilderPayoffsAction} className="flex flex-col gap-3 max-w-2xl">
      <input type="hidden" name="scriptId" value={scriptId} />
      <p className="text-sm text-[var(--mute)]">List the 3-8 key information payoffs your video will deliver, in order (FR-SB-07).</p>
      <textarea name="payoffs" rows={10} defaultValue={state.payoffs.join("\n")} placeholder="One payoff per line, e.g.\nWhy this approach typically fails\nThe 80/20 of what works\nA simple test you can run today" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
      <div className="flex justify-end"><button type="submit" className="btn primary sm">Save payoffs</button></div>
    </form>
  );
}

// ── Step 7 — Draft ──────────────────────────────────────────────────────
function StepDraft({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--mute)]">Generate the full script section-by-section. Regenerate any section without affecting the others (FR-SB-08).</p>
      <form action={generateBuilderDraftAction}>
        <input type="hidden" name="scriptId" value={scriptId} />
        <button type="submit" className="btn primary">{state.sections.length > 0 ? "Regenerate full draft" : "Generate full draft"}</button>
      </form>

      {state.sections.map((s, i) => (
        <section key={i} className="card">
          <div className="flex items-center mb-2">
            <h3 className="font-mono font-bold text-sm">{s.title}</h3>
            <span className="flex-1" />
            <form action={regenerateBuilderSectionAction}>
              <input type="hidden" name="scriptId" value={scriptId} />
              <input type="hidden" name="index" value={i} />
              <button type="submit" className="btn sm flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Regenerate</button>
            </form>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-[1.6]">{s.content}</pre>
        </section>
      ))}
    </div>
  );
}

// ── Step 8 — Edit ───────────────────────────────────────────────────────
function StepEdit({ scriptId }: { scriptId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--mute)]">Polish the draft with the standard Canvas tools — Highlight-and-Improve, Humanize, autosave (FR-SB-09).</p>
      <Link href={`/scripts/${scriptId}?tab=script`} className="btn primary w-fit">Open Canvas editor →</Link>
    </div>
  );
}

// ── Step 9 — Export ─────────────────────────────────────────────────────
function StepExport({ scriptId, body }: { scriptId: string; body: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--mute)]">Export the finished script (FR-SB-10).</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={body} label="Copy to clipboard" />
        <a href={`/api/scripts/${scriptId}/export?format=docx`} className="btn">Download .docx</a>
        <a href={`/api/scripts/${scriptId}/export?format=pdf`}  className="btn">Download .pdf</a>
        <Link href={`/teleprompter/${scriptId}`} className="btn">Teleprompter</Link>
      </div>
    </div>
  );
}

// ── Step 10 — Publish ───────────────────────────────────────────────────
function StepPublish({ scriptId, state }: { scriptId: string; state: BuilderState }) {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <p className="text-sm text-[var(--mute)]">Generate YouTube tags, description, and metadata (FR-SB-11).</p>
      <form action={generateBuilderPublishAction}>
        <input type="hidden" name="scriptId" value={scriptId} />
        <button type="submit" className="btn primary">{state.publish?.description ? "Regenerate" : "Generate description, tags & metadata"}</button>
      </form>
      {state.publish?.description && (
        <>
          <div className="card">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2 flex items-center gap-2"><ListChecks className="w-3.5 h-3.5" /> Generated metadata</h3>
            <pre className="text-xs font-mono whitespace-pre-wrap leading-[1.5]">{state.publish.description}</pre>
            <div className="flex justify-end mt-2"><CopyButton text={state.publish.description} /></div>
          </div>
          <Link href={`/scripts/${scriptId}/publish`} className="btn">Full publish dashboard →</Link>
        </>
      )}
    </div>
  );
}
