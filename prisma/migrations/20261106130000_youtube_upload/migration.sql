-- E-VID-03: a project's video sent to the workspace's YouTube channel.
CREATE TABLE "YoutubeUpload" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" BIGINT,
    "sent" BIGINT NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "privacy" TEXT NOT NULL DEFAULT 'private',
    "publishAt" TIMESTAMP(3),
    "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailKey" TEXT,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "session" TEXT,
    "videoId" TEXT,
    "thumbnailNote" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoutubeUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YoutubeUpload_workspaceId_projectId_idx" ON "YoutubeUpload"("workspaceId", "projectId");

ALTER TABLE "YoutubeUpload" ADD CONSTRAINT "YoutubeUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
