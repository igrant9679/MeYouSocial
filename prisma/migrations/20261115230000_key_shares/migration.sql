-- Key sharing between workspaces (2026-11-15): a pointer from the workspace that
-- uses a key to the workspace that stores it. The key itself is never copied.

CREATE TABLE "KeyShare" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fromWorkspaceId" TEXT NOT NULL,
    "toWorkspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeyShare_fromWorkspaceId_key_idx" ON "KeyShare"("fromWorkspaceId", "key");

CREATE UNIQUE INDEX "KeyShare_toWorkspaceId_key_key" ON "KeyShare"("toWorkspaceId", "key");

ALTER TABLE "KeyShare" ADD CONSTRAINT "KeyShare_fromWorkspaceId_fkey" FOREIGN KEY ("fromWorkspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeyShare" ADD CONSTRAINT "KeyShare_toWorkspaceId_fkey" FOREIGN KEY ("toWorkspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
