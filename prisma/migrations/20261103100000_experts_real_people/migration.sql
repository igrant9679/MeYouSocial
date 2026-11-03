-- E-IDE-14: experts vs personas, pending seeded answers, experts linked to Topics.
-- AlterTable
ALTER TABLE "SmeProfile" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'expert',
ADD COLUMN     "pendingAnswers" TEXT NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "_ExpertTopics" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExpertTopics_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ExpertTopics_B_index" ON "_ExpertTopics"("B");

-- AddForeignKey
ALTER TABLE "_ExpertTopics" ADD CONSTRAINT "_ExpertTopics_A_fkey" FOREIGN KEY ("A") REFERENCES "SmeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpertTopics" ADD CONSTRAINT "_ExpertTopics_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

