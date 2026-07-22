-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "eeatReview" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outline" TEXT,
ADD COLUMN     "readingLevel" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "secondaryKeywords" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "tone" TEXT;

-- CreateTable
CREATE TABLE "BlogPostVersion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogPostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 3,
    "intent" TEXT,
    "cluster" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlogPostVersion_postId_createdAt_idx" ON "BlogPostVersion"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Keyword_workspaceId_cluster_idx" ON "Keyword"("workspaceId", "cluster");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_workspaceId_phrase_key" ON "Keyword"("workspaceId", "phrase");

-- CreateIndex
CREATE UNIQUE INDEX "SitePage_workspaceId_url_key" ON "SitePage"("workspaceId", "url");

-- AddForeignKey
ALTER TABLE "BlogPostVersion" ADD CONSTRAINT "BlogPostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

