import { db } from "@/lib/db";

/**
 * One UsageLog row per AI call (audit SET-02): what Settings → Usage reports
 * per provider and model. Written by the two routers (lib/llm, lib/images), so
 * no caller can forget it. The actor is unknown there — the per-person soft
 * limits count their own rows. Never throws: metering must not cost anyone a
 * generation.
 */
export async function meterAi(row: {
  workspaceId?: string | null;
  action: "ai.text" | "ai.image";
  provider: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<void> {
  if (!row.workspaceId) return;
  const counted = row.inputTokens != null || row.outputTokens != null;
  await db.usageLog
    .create({
      data: {
        workspaceId: row.workspaceId,
        action: row.action,
        provider: row.provider,
        model: row.model ?? null,
        inputTokens: row.inputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        tokens: counted ? (row.inputTokens ?? 0) + (row.outputTokens ?? 0) : null,
      },
    })
    .catch(() => {});
}
