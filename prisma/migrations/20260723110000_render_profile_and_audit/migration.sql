-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "renderProfile" TEXT NOT NULL DEFAULT 'html',
ADD COLUMN     "renderRules" TEXT NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ContentAuditItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'wordpress',
    "wordCount" INTEGER,
    "slopScore" INTEGER,
    "findings" TEXT NOT NULL DEFAULT '[]',
    "recommendation" TEXT NOT NULL DEFAULT 'keep',
    "reason" TEXT,
    "mergeTargetUrl" TEXT,
    "position" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentAuditItem_workspaceId_status_idx" ON "ContentAuditItem"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAuditItem_workspaceId_url_key" ON "ContentAuditItem"("workspaceId", "url");
