-- E-IDE-04: an article retired or merged, and where its address points now.
-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "redirectTo" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

