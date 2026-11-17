-- Elsie's suggestions (2026-11-16): the ones a person told her not to make again.
-- One row per person, workspace and suggestion key; "Show them again" deletes them.

CREATE TABLE "ElsieDismissal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElsieDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElsieDismissal_workspaceId_userId_key_key" ON "ElsieDismissal"("workspaceId", "userId", "key");

ALTER TABLE "ElsieDismissal" ADD CONSTRAINT "ElsieDismissal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
