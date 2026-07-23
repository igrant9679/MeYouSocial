-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "smeProfileId" TEXT;

-- AlterTable
ALTER TABLE "BlogIdea" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "dedupeNote" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "motifs" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "priority" INTEGER,
ADD COLUMN     "priorityReason" TEXT,
ADD COLUMN     "refreshPostId" TEXT,
ADD COLUMN     "seasonalHook" TEXT,
ADD COLUMN     "targetPage" TEXT,
ADD COLUMN     "tier" INTEGER;

-- CreateTable
CREATE TABLE "SmeProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "credentials" TEXT,
    "bio" TEXT,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "alwaysSay" TEXT,
    "neverSay" TEXT,
    "topics" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmeProfileVersion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmeProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmeProfile_workspaceId_status_idx" ON "SmeProfile"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SmeProfileVersion_profileId_version_idx" ON "SmeProfileVersion"("profileId", "version");

-- AddForeignKey
ALTER TABLE "SmeProfileVersion" ADD CONSTRAINT "SmeProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SmeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
