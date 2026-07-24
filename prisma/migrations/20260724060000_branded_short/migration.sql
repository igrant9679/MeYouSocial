-- CreateTable
CREATE TABLE "BrandedShort" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blogPostId" TEXT,
    "title" TEXT NOT NULL,
    "eyebrow" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rendering',
    "provider" TEXT NOT NULL DEFAULT 'heygen',
    "variables" TEXT NOT NULL DEFAULT '{}',
    "renderId" TEXT,
    "videoUrl" TEXT,
    "storedUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandedShort_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandedShort_workspaceId_createdAt_idx" ON "BrandedShort"("workspaceId", "createdAt");

