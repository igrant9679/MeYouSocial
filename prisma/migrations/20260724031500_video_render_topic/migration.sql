-- AlterTable
ALTER TABLE "VideoRender" ADD COLUMN     "topicId" TEXT;

-- AddForeignKey
ALTER TABLE "VideoRender" ADD CONSTRAINT "VideoRender_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

