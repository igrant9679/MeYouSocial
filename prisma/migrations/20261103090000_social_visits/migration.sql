-- E-MEA-07: the visits social posts brought, from GA4 (a rolling 28-day snapshot).
-- CreateTable
CREATE TABLE "SocialVisit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postId" TEXT,
    "campaignId" TEXT,
    "page" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "campaign" TEXT,
    "sessions" INTEGER NOT NULL,
    "engaged" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialVisit_workspaceId_idx" ON "SocialVisit"("workspaceId");

-- CreateIndex
CREATE INDEX "SocialVisit_postId_idx" ON "SocialVisit"("postId");

-- CreateIndex
CREATE INDEX "SocialVisit_campaignId_idx" ON "SocialVisit"("campaignId");

-- AddForeignKey
ALTER TABLE "SocialVisit" ADD CONSTRAINT "SocialVisit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialVisit" ADD CONSTRAINT "SocialVisit_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialVisit" ADD CONSTRAINT "SocialVisit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

