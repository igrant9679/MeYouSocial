-- CreateTable
CREATE TABLE "PostingSlot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingSlot_workspaceId_idx" ON "PostingSlot"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSlot_workspaceId_weekday_minute_key" ON "PostingSlot"("workspaceId", "weekday", "minute");

-- AddForeignKey
ALTER TABLE "PostingSlot" ADD CONSTRAINT "PostingSlot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

