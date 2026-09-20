-- An Engage item a person decided not to act on (audit A5). Reviews and DMs
-- live on the network and cannot be archived there, so this is the app's own
-- memory of the decision: still listed, no longer counted as work.
CREATE TABLE "SocialInboxDismissal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialInboxDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialInboxDismissal_workspaceId_kind_targetId_key" ON "SocialInboxDismissal"("workspaceId", "kind", "targetId");
CREATE INDEX "SocialInboxDismissal_workspaceId_kind_idx" ON "SocialInboxDismissal"("workspaceId", "kind");

ALTER TABLE "SocialInboxDismissal" ADD CONSTRAINT "SocialInboxDismissal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
