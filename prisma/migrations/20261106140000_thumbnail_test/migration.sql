-- E-VID-05: a thumbnail A/B on a published video, rotated and scored by YouTube's reach reports.
CREATE TABLE "ThumbnailTest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "videoId" TEXT NOT NULL,
    "variants" TEXT NOT NULL,
    "daysEach" INTEGER NOT NULL DEFAULT 7,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "current" INTEGER NOT NULL DEFAULT 0,
    "windows" TEXT NOT NULL DEFAULT '[]',
    "dayData" TEXT NOT NULL DEFAULT '{}',
    "result" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThumbnailTest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ThumbnailTest_state_idx" ON "ThumbnailTest"("state");

CREATE INDEX "ThumbnailTest_workspaceId_projectId_idx" ON "ThumbnailTest"("workspaceId", "projectId");

ALTER TABLE "ThumbnailTest" ADD CONSTRAINT "ThumbnailTest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
