"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import { cancelAgentAction } from "@/app/actions/agent";

type Step = { name: string; status: "queued" | "running" | "done" | "failed" | "cancelled"; note?: string };

const STEP_LABELS: Record<string, string> = {
  research: "Research",
  outline: "Outline",
  script: "Script draft",
  qa_retention: "QA · retention",
  qa_humanize: "QA · humanize",
  qa_repetition: "QA · repetition",
  voiceover: "Voiceover prep",
};

export function AgentPanel({ scriptId, runId, initialStatus }: { scriptId: string; runId: string; initialStatus: string }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (status === "succeeded" || status === "failed" || status === "cancelled") return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scripts/${scriptId}/agent/${runId}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!alive) return;
        setSteps(json.steps ?? []);
        setProgress(json.progress ?? 0);
        setStatus(json.status);
        if (json.status === "succeeded" || json.status === "failed" || json.status === "cancelled") {
          // Refresh server-rendered body now that the pipeline is done.
          setTimeout(() => location.reload(), 800);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [scriptId, runId, status]);

  const running = status === "queued" || status === "running";
  const accent = status === "succeeded" ? "var(--green)" : status === "failed" ? "var(--brand)" : status === "cancelled" ? "var(--mute)" : "var(--accent)";
  const soft = status === "succeeded" ? "var(--green-soft)" : status === "failed" ? "var(--brand-soft)" : status === "cancelled" ? "var(--zebra)" : "var(--accent-soft)";

  return (
    <div className="card mb-4" style={{ borderColor: accent }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: soft, color: accent }}>
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
        </span>
        <div className="font-mono font-bold text-[14px]">Agent run</div>
        <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: soft, color: accent }}>{status}</span>
        <span className="flex-1" />
        {running && (
          <form action={cancelAgentAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="scriptId" value={scriptId} />
            <button type="submit" className="btn sm">Cancel</button>
          </form>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden mb-3">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: Math.round(progress * 100) + "%", background: accent }} />
      </div>

      <ul className="m-0 p-0 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {steps.length === 0 && Object.keys(STEP_LABELS).map((name) => (
          <StepBadge key={name} step={{ name, status: "queued" }} />
        ))}
        {steps.map((s) => <StepBadge key={s.name} step={s} />)}
      </ul>

      {status === "succeeded" && <p className="text-xs text-[var(--green)] mt-2">Script ready. Refreshing…</p>}
      {status === "failed" && <p className="text-xs text-[var(--brand)] mt-2">Failed. Use the Retry button to try again.</p>}
    </div>
  );
}

function StepBadge({ step }: { step: Step }) {
  const label = STEP_LABELS[step.name] ?? step.name;
  let Icon = Circle;
  let color = "var(--mute)";
  if (step.status === "running") { Icon = Loader2; color = "var(--accent)"; }
  if (step.status === "done") { Icon = CheckCircle2; color = "var(--green)"; }
  if (step.status === "failed") { Icon = XCircle; color = "var(--brand)"; }
  if (step.status === "cancelled") { Icon = XCircle; color = "var(--mute)"; }

  return (
    <li className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--line)]">
      <Icon className={"w-3.5 h-3.5 flex-shrink-0 " + (step.status === "running" ? "animate-spin" : "")} style={{ color }} />
      <span className="truncate" style={{ color: step.status === "queued" ? "var(--mute)" : "var(--ink)" }}>{label}</span>
      {step.note && <span className="text-[10px] text-[var(--mute)] ml-auto">{step.note}</span>}
    </li>
  );
}
