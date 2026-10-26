-- Audit Phase 1 (2026-10-26).
-- A refresh idea revises the existing article; its next publish updates the
-- WordPress post in place rather than creating a competing one.
ALTER TABLE "BlogPost" ADD COLUMN "refreshStartedAt" TIMESTAMP(3);

-- Production assets get an owner (SEC-17). Channel-scoped rows take their
-- channel's workspace; rows saved for "All channels" had no owner and stay
-- NULL, which no workspace's library shows any more.
ALTER TABLE "Asset" ADD COLUMN "workspaceId" TEXT;
UPDATE "Asset" a SET "workspaceId" = c."workspaceId" FROM "Channel" c WHERE a."channelId" = c."id";
CREATE INDEX "Asset_workspaceId_idx" ON "Asset"("workspaceId");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
