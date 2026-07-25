-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "confidence" TEXT NOT NULL DEFAULT 'none',
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "actionKey" TEXT,
    "actionPayload" TEXT,
    "actionLabel" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedBy" TEXT,
    "dismissedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_workspaceId_status_createdAt_idx" ON "Recommendation"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_workspaceId_fingerprint_idx" ON "Recommendation"("workspaceId", "fingerprint");

