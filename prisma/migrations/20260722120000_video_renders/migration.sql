-- CreateTable
CREATE TABLE "VideoRender" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blogPostId" TEXT,
    "scriptId" TEXT,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "seconds" INTEGER NOT NULL DEFAULT 8,
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "outputUrl" TEXT,
    "error" TEXT,
    "costEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoRender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoRender_workspaceId_status_idx" ON "VideoRender"("workspaceId", "status");

