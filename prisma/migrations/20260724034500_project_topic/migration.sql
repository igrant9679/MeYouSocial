-- AlterTable
ALTER TABLE "ContentProject" ADD COLUMN     "topicId" TEXT;

-- AddForeignKey
ALTER TABLE "ContentProject" ADD CONSTRAINT "ContentProject_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

