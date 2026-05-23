import Link from "next/link";
import { ArrowLeft, PenLine, FileText, MessageCircle, History, ListTree, Type, Bot } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { MODELS } from "@/lib/llm/models";
import { formatDuration } from "@/lib/canvas/duration";
import { ScriptEditor } from "./ScriptEditor";
import { StartOverButton } from "./StartOverButton";
import { AgentPanel } from "./AgentPanel";
import { StreamButton } from "./StreamButton";
import { launchAgentAction } from "@/app/actions/agent";
import { promoteScriptAction } from "@/app/actions/production";
import {
  savePlanQuestionsAction,
  generateOutlineAction,
  saveOutlineAction,
  generateScriptAction,
  updateScriptSettingsAction,
} from "@/app/actions/canvas";

// MU-04 — Script Canvas. Implements FR-CANV-01..15 (15 [Must] items).

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "plan" } = await searchParams;
  const { workspace } = await requireMembership();

  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: {
      channel: true,
      idea: true,
      template: true,
      chat: { include: { messages: { orderBy: { createdAt: "asc" }, take: 12 } } },
      versions: { orderBy: { createdAt: "desc" }, take: 8 },
      agentRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  if (!script) notFound();

  const outline = readJson<{ questions?: Record<string, string>; markdown?: string }>(script.outline ?? null, {});
  const templates = await db.template.findMany({ where: { OR: [{ channelId: script.channelId }, { channelId: null }] }, orderBy: { name: "asc" } });
  const activeTab = (tab === "script" ? "script" : "plan") as "plan" | "script";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 h-[calc(100vh-120px)]">
      {/* LEFT: Chat pane (FR-CANV-02) */}
      <aside className="card flex flex-col p-0 overflow-hidden h-full">
        <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "#EDE7FB", color: "#6D28D9" }}><MessageCircle className="w-4 h-4" /></span>
          <div className="text-xs font-mono uppercase tracking-wider text-[var(--mute)]">Canvas chat</div>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-2.5 text-sm min-h-[280px]">
          {script.chat ? (
            <>
              {script.chat.messages.length === 0 && (
                <p className="text-xs text-[var(--mute)] text-center mt-8">No chat yet — open the full chat to brainstorm with this script as context.</p>
              )}
              {script.chat.messages.map((m) => (
                <div key={m.id} className={"flex " + (m.role === "user" ? "justify-end" : "")}>
                  <div className={"rounded-2xl px-3 py-2 max-w-[85%] whitespace-pre-wrap " + (m.role === "user" ? "bg-[var(--accent)] text-white text-xs" : "bg-[var(--zebra)] border border-[var(--line)] text-xs")}>
                    {m.content}
                  </div>
                </div>
              ))}
              <Link href={`/chat/${script.chat.id}`} className="text-[11px] font-mono text-[var(--accent)] hover:underline mt-2 text-center">Open in full chat →</Link>
            </>
          ) : (
            <p className="text-xs text-[var(--mute)] text-center mt-8">No chat thread linked to this script yet.</p>
          )}
        </div>
      </aside>

      {/* RIGHT: Editor pane */}
      <main className="card flex flex-col p-0 overflow-hidden h-full">
        {/* Top toolbar */}
        <div className="px-5 py-3 border-b border-[var(--line)] flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Link href={`/channels/${script.channelId}/scripts`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> {script.channel.name}</Link>
            <Link href={`/scripts/${script.id}/builder`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1" title="Switch to the 10-step Script Builder (FR-SB)">Builder mode →</Link>
            <span className="flex-1" />
            {/* FR-AGENT-01 — Launch agent. Disabled while a run is in flight. */}
            {(() => {
              const latest = script.agentRuns[0];
              const inFlight = latest && (latest.status === "queued" || latest.status === "running");
              if (inFlight) return null;
              return (
                <form action={launchAgentAction}>
                  <input type="hidden" name="scriptId" value={script.id} />
                  <button type="submit" className="btn sm flex items-center gap-1.5" style={{ background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }} title="Run the automated research+outline+script+QA pipeline">
                    <Bot className="w-3.5 h-3.5" /> {script.body ? "Re-run Agent" : "Run Agent"}
                  </button>
                </form>
              );
            })()}
            {script.body && (
              <Link href={`/scripts/${script.id}/publish`} className="btn sm flex items-center gap-1.5" title="Export, teleprompter, promo assets">
                Publish →
              </Link>
            )}
            {/* FR-PIPE-01 — promote into a tracked Content Project */}
            <form action={promoteScriptAction}>
              <input type="hidden" name="scriptId" value={script.id} />
              <button type="submit" className="btn sm" title="Track this script in the production pipeline">Track in production →</button>
            </form>
            {/* FR-CANV-12 — Start Over with warning */}
            <StartOverButton scriptId={script.id} hasBody={!!script.body} />
          </div>

          {/* Title + model + template (FR-CANV-06/07) */}
          <form action={updateScriptSettingsAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="scriptId" value={script.id} />
            <Type className="w-4 h-4 text-[var(--mute)]" />
            <input name="title" defaultValue={script.title} className="font-mono font-bold text-lg border-0 border-b border-transparent hover:border-[var(--line-2)] focus:border-[var(--accent)] focus:outline-none flex-1 min-w-[200px] bg-transparent" />
            <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
              Model
              <select name="model" defaultValue={script.model ?? ""} className="border border-[var(--line-2)] rounded-md p-1 text-xs font-mono">
                <option value="">Channel default</option>
                {MODELS.filter((m) => m.provider !== "mock").map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                <option value="mock-fast">Mock (fast)</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
              Template
              <select name="templateId" defaultValue={script.templateId ?? ""} className="border border-[var(--line-2)] rounded-md p-1 text-xs font-mono">
                <option value="">None</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>

          {/* Tabs (FR-CANV-05) */}
          <div className="flex items-center gap-1 mt-1">
            <TabLink href={`/scripts/${script.id}?tab=plan`} active={activeTab === "plan"} icon={<ListTree className="w-3.5 h-3.5" />}>Plan</TabLink>
            <TabLink href={`/scripts/${script.id}?tab=script`} active={activeTab === "script"} icon={<FileText className="w-3.5 h-3.5" />}>Script</TabLink>
            <span className="flex-1" />
            {script.body && (
              <span className="text-[11px] font-mono text-[var(--mute)]">
                {script.wordCount.toLocaleString()} words · {formatDuration(script.durationSeconds)}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {script.agentRuns[0] && (
            <AgentPanel
              scriptId={script.id}
              runId={script.agentRuns[0].id}
              initialStatus={script.agentRuns[0].status}
            />
          )}
          {activeTab === "plan" ? (
            <PlanTab script={{ id: script.id, outline }} />
          ) : (
            <ScriptTab scriptId={script.id} body={script.body ?? ""} hasOutline={!!outline.markdown} />
          )}
        </div>

        {/* Versions footer (FR-CANV-14 partial) */}
        {script.versions.length > 0 && (
          <details className="border-t border-[var(--line)] px-5 py-2">
            <summary className="text-xs font-mono text-[var(--mute)] cursor-pointer flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Version snapshots ({script.versions.length})</summary>
            <ul className="m-0 p-0 mt-2 text-xs grid grid-cols-1 md:grid-cols-2 gap-1">
              {script.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 text-[var(--mute)]">
                  <span className="font-mono">{new Date(v.createdAt).toLocaleString()}</span>
                  <span>·</span>
                  <span className="truncate">{v.label}</span>
                  <span className="text-[10px]">({v.wordCount} w)</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
}

function TabLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition " + (active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--mute)] hover:bg-[var(--zebra)]")}
    >
      {icon} {children}
    </Link>
  );
}

function PlanTab({ script }: { script: { id: string; outline: { questions?: Record<string, string>; markdown?: string } } }) {
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Planning questions (FR-CANV-03) */}
      <form action={savePlanQuestionsAction} className="card">
        <h3 className="font-mono font-bold text-[15px] mb-3 flex items-center gap-2"><ListTree className="w-4 h-4" style={{ color: "var(--accent)" }} /> Planning questions</h3>
        <input type="hidden" name="scriptId" value={script.id} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlanField name="takeaway" label="One main takeaway" defaultValue={script.outline.questions?.takeaway} />
          <PlanField name="concerns" label="What worries the audience?" defaultValue={script.outline.questions?.concerns} />
          <PlanField name="points" label="Key points to cover" defaultValue={script.outline.questions?.points} />
          <PlanField name="action" label="Desired viewer action" defaultValue={script.outline.questions?.action} />
        </div>
        <div className="flex justify-end mt-3">
          <button type="submit" className="btn sm">Save answers</button>
        </div>
      </form>

      {/* Generate / edit outline */}
      <div className="card">
        <div className="flex items-center mb-3">
          <h3 className="font-mono font-bold text-[15px] flex items-center gap-2"><PenLine className="w-4 h-4" style={{ color: "var(--accent)" }} /> Outline</h3>
          <span className="flex-1" />
          <form action={generateOutlineAction}>
            <input type="hidden" name="scriptId" value={script.id} />
            <button type="submit" className="btn sm">{script.outline.markdown ? "Regenerate" : "Generate outline"}</button>
          </form>
          <StreamButton scriptId={script.id} stage="outline" label="Stream outline" />
        </div>

        {script.outline.markdown ? (
          <>
            <form action={saveOutlineAction} className="flex flex-col gap-2">
              <input type="hidden" name="scriptId" value={script.id} />
              <textarea
                name="markdown"
                rows={16}
                defaultValue={script.outline.markdown}
                className="border border-[var(--line-2)] rounded-lg p-3 text-sm font-mono leading-[1.6]"
              />
              <div className="flex justify-between items-center">
                <p className="text-xs text-[var(--mute)]">Edit the outline directly — saves on click.</p>
                <button type="submit" className="btn sm">Save outline</button>
              </div>
            </form>

            <form action={generateScriptAction} className="mt-3 border-t border-[var(--line)] pt-3 flex items-center gap-2">
              <input type="hidden" name="scriptId" value={script.id} />
              <p className="text-xs text-[var(--mute)] flex-1">Approve the outline and expand into the full script.</p>
              <Link href={`/scripts/${script.id}?tab=script`} className="btn sm">View script tab</Link>
              <button type="submit" className="btn sm">Approve & write</button>
            </form>
            <div className="mt-2">
              <StreamButton scriptId={script.id} stage="script" label="Stream full script" />
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--mute)] text-center py-6">No outline yet. Answer the planning questions and click <b>Generate outline</b>.</p>
        )}
      </div>
    </div>
  );
}

function PlanField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</span>
      <textarea name={name} rows={2} defaultValue={defaultValue ?? ""} className="border border-[var(--line-2)] rounded-md p-2 text-sm" />
    </label>
  );
}

function ScriptTab({ scriptId, body, hasOutline }: { scriptId: string; body: string; hasOutline: boolean }) {
  if (!body && !hasOutline) {
    return (
      <div className="text-center py-12">
        <FileText className="w-10 h-10 mx-auto mb-3 text-[var(--mute)]" strokeWidth={1.5} />
        <p className="text-sm text-[var(--mute)] mb-3">No outline yet. Head to the <b>Plan</b> tab first.</p>
        <Link href={`/scripts/${scriptId}?tab=plan`} className="btn primary sm">Open Plan</Link>
      </div>
    );
  }
  if (!body) {
    return (
      <div className="text-center py-12">
        <FileText className="w-10 h-10 mx-auto mb-3 text-[var(--mute)]" strokeWidth={1.5} />
        <p className="text-sm text-[var(--mute)] mb-3">Outline is ready. Generate the full script now.</p>
        <form action={generateScriptAction}>
          <input type="hidden" name="scriptId" value={scriptId} />
          <button type="submit" className="btn primary">Generate script</button>
        </form>
      </div>
    );
  }
  return <ScriptEditor scriptId={scriptId} initialBody={body} />;
}
