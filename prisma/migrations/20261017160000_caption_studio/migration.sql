-- Socialmonials parity, phase 3 (2026-10-17): Caption Studio — the special
-- days calendar and the caption batches reviewed before anything is queued.

-- CreateTable
CREATE TABLE "SpecialDay" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "note" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "selectedBy" TEXT,
    "selectedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "campaignId" TEXT,
    "input" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'review',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "savedAt" TIMESTAMP(3),

    CONSTRAINT "CaptionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialDay_workspaceId_day_idx" ON "SpecialDay"("workspaceId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialDay_workspaceId_day_name_key" ON "SpecialDay"("workspaceId", "day", "name");

-- CreateIndex
CREATE INDEX "CaptionBatch_workspaceId_createdAt_idx" ON "CaptionBatch"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "SpecialDay" ADD CONSTRAINT "SpecialDay_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionBatch" ADD CONSTRAINT "CaptionBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionBatch" ADD CONSTRAINT "CaptionBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

