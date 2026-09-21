-- Topics as the spine (2026-09-21), phase 1: the social format gets an idea
-- stage, and article ideas keep their link to the research that produced them.
--
-- No backfill on purpose: legacy ideas are untagged and the board's
-- "No topic yet" lane says so. The 32 existing SocialVariant rows are not
-- converted — they belong to articles already published, and a converted
-- idea would be a post proposed twice.

-- AlterTable
ALTER TABLE "BlogIdea" ADD COLUMN     "sourceVideoId" TEXT;

-- CreateTable
CREATE TABLE "SocialIdea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "topicId" TEXT,
    "hook" TEXT NOT NULL,
    "angle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceVideoId" TEXT,
    "sourceBlogPostId" TEXT,
    "socialPostId" TEXT,
    "priority" INTEGER,
    "createdById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialIdea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialIdea_socialPostId_key" ON "SocialIdea"("socialPostId");

-- CreateIndex
CREATE INDEX "SocialIdea_workspaceId_status_idx" ON "SocialIdea"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SocialIdea_topicId_idx" ON "SocialIdea"("topicId");

-- CreateIndex
CREATE INDEX "BlogIdea_topicId_idx" ON "BlogIdea"("topicId");

-- AddForeignKey
ALTER TABLE "BlogIdea" ADD CONSTRAINT "BlogIdea_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "IntelVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "IntelVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_sourceBlogPostId_fkey" FOREIGN KEY ("sourceBlogPostId") REFERENCES "BlogPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

