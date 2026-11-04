-- E-SOC-17: who in the team owns an Engage thread.
-- CreateTable
CREATE TABLE "EngageAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "accountId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngageAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngageAssignment_workspaceId_assigneeId_idx" ON "EngageAssignment"("workspaceId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "EngageAssignment_workspaceId_kind_targetId_key" ON "EngageAssignment"("workspaceId", "kind", "targetId");

-- AddForeignKey
ALTER TABLE "EngageAssignment" ADD CONSTRAINT "EngageAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

