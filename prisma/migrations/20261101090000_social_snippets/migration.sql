-- CreateTable
CREATE TABLE "SocialSnippet" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialSnippet_workspaceId_idx" ON "SocialSnippet"("workspaceId");

-- AddForeignKey
ALTER TABLE "SocialSnippet" ADD CONSTRAINT "SocialSnippet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

