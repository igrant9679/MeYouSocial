-- DropForeignKey
ALTER TABLE "StoredObject" DROP CONSTRAINT "StoredObject_workspaceId_fkey";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "pausedBeforeDelete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purgeAfter" TIMESTAMP(3),
ADD COLUMN     "purgeStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoredObject" ALTER COLUMN "workspaceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Workspace_deletedAt_idx" ON "Workspace"("deletedAt");

-- AddForeignKey
ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

