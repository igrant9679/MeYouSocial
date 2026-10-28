-- Audit SET-02: per-provider usage. Every AI text call and image render is metered.
ALTER TABLE "UsageLog" ADD COLUMN "provider" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "UsageLog" ADD COLUMN "outputTokens" INTEGER;

CREATE INDEX "UsageLog_workspaceId_action_createdAt_idx" ON "UsageLog"("workspaceId", "action", "createdAt");
