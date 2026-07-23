-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "text" TEXT NOT NULL,
    "mediaKeys" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostTarget" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "unipileAccountId" TEXT NOT NULL,
    "accountName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerPostId" TEXT,
    "error" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "SocialPostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_workspaceId_status_idx" ON "SocialPost"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledAt_idx" ON "SocialPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SocialPostTarget_postId_idx" ON "SocialPostTarget"("postId");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostTarget" ADD CONSTRAINT "SocialPostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

