-- Socialmonials parity, phase 4 (2026-10-17): RSS feeds (items become social
-- ideas or drafts) and the media library; social ideas keep an RSS item's link.

-- AlterTable
ALTER TABLE "SocialIdea" ADD COLUMN     "sourceUrl" TEXT;

-- CreateTable
CREATE TABLE "RssFeed" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'ideas',
    "topicId" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssItem" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "link" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3),
    "socialIdeaId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RssItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contentType" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RssFeed_workspaceId_url_key" ON "RssFeed"("workspaceId", "url");

-- CreateIndex
CREATE INDEX "RssItem_feedId_createdAt_idx" ON "RssItem"("feedId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RssItem_feedId_guid_key" ON "RssItem"("feedId", "guid");

-- CreateIndex
CREATE INDEX "MediaItem_workspaceId_createdAt_idx" ON "MediaItem"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_workspaceId_key_key" ON "MediaItem"("workspaceId", "key");

-- AddForeignKey
ALTER TABLE "RssFeed" ADD CONSTRAINT "RssFeed_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssItem" ADD CONSTRAINT "RssItem_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "RssFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

