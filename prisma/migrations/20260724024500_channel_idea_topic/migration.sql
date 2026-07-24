-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "topicId" TEXT;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

