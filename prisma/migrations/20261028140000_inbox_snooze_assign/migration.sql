-- CreateTable
CREATE TABLE "InboxSnooze" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxSnooze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxSnooze_workspaceId_userId_until_idx" ON "InboxSnooze"("workspaceId", "userId", "until");

-- CreateIndex
CREATE UNIQUE INDEX "InboxSnooze_workspaceId_userId_itemKey_key" ON "InboxSnooze"("workspaceId", "userId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "InboxAssignment_workspaceId_itemKey_key" ON "InboxAssignment"("workspaceId", "itemKey");

-- AddForeignKey
ALTER TABLE "InboxSnooze" ADD CONSTRAINT "InboxSnooze_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxAssignment" ADD CONSTRAINT "InboxAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

