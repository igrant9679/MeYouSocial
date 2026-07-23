-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "logoKey" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceSetting" (
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("workspaceId","key")
);

-- AddForeignKey
ALTER TABLE "WorkspaceSetting" ADD CONSTRAINT "WorkspaceSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

