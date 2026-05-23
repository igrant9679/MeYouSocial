"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { registerAgentJobs } from "@/lib/jobs/agent";

registerAgentJobs();

/** FR-AGENT-01 — Launch the automated pipeline from a script. */
export async function launchAgentAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
  });
  if (!script) return;

  const run = await db.agentRun.create({
    data: { scriptId: script.id, status: "queued" },
  });
  await jobs.enqueue("agent.run", { runId: run.id, scriptId: script.id });
  revalidatePath(`/scripts/${script.id}`);
}

/** FR-AGENT-04 — Immediate cancel. */
export async function cancelAgentAction(formData: FormData) {
  const runId = String(formData.get("runId"));
  const { workspace } = await requireRole("EDITOR");
  await db.agentRun.updateMany({
    where: { id: runId, script: { channel: { workspaceId: workspace.id } } },
    data: { status: "cancelled", endedAt: new Date() },
  });
  const scriptId = String(formData.get("scriptId"));
  revalidatePath(`/scripts/${scriptId}`);
}

/** FR-AGENT-04 — Retry (creates a new run). */
export async function retryAgentAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  await launchAgentAction(formData);
  revalidatePath(`/scripts/${scriptId}`);
}
