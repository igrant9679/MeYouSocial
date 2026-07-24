-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "topicId" TEXT;

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_topicId_idx" ON "SocialPost"("workspaceId", "topicId");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

