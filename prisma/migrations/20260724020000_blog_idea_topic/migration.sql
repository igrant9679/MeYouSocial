-- AlterTable
ALTER TABLE "BlogIdea" ADD COLUMN     "topicId" TEXT;

-- AddForeignKey
ALTER TABLE "BlogIdea" ADD CONSTRAINT "BlogIdea_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

