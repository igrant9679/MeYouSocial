-- Campaigns, evergreen recycling, approval workflow, slot categories.

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utmCampaign" TEXT,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "evergreen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recycleEveryDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "recycleUntil" TIMESTAMP(3),
ADD COLUMN     "lastRecycledAt" TIMESTAMP(3),
ADD COLUMN     "timesRecycled" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recycledFromId" TEXT,
ADD COLUMN     "approval" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT;

-- AlterTable
ALTER TABLE "PostingSlot" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_workspaceId_name_key" ON "Campaign"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_campaignId_idx" ON "SocialPost"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_evergreen_idx" ON "SocialPost"("workspaceId", "evergreen");

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_approval_idx" ON "SocialPost"("workspaceId", "approval");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_recycledFromId_fkey" FOREIGN KEY ("recycledFromId") REFERENCES "SocialPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
