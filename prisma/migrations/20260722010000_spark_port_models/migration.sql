-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "protectedFromRewrite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrgProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "services" TEXT NOT NULL DEFAULT '[]',
    "audience" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogCitation" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogIdea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT,
    "keyword" TEXT,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordPressConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encAppPassword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordPressConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialVariant" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "position" DOUBLE PRECISION,
    "sessions" INTEGER,
    "conversions" INTEGER,

    CONSTRAINT "BlogSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionMode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunctionMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "globalPause" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgProfile_workspaceId_key" ON "OrgProfile"("workspaceId");

-- CreateIndex
CREATE INDEX "BlogCitation_postId_idx" ON "BlogCitation"("postId");

-- CreateIndex
CREATE INDEX "BlogIdea_workspaceId_status_idx" ON "BlogIdea"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WordPressConnection_workspaceId_key" ON "WordPressConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "SocialVariant_postId_idx" ON "SocialVariant"("postId");

-- CreateIndex
CREATE INDEX "BlogSnapshot_postId_idx" ON "BlogSnapshot"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "FunctionMode_workspaceId_function_key" ON "FunctionMode"("workspaceId", "function");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationState_workspaceId_key" ON "AutomationState"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "BlogCitation" ADD CONSTRAINT "BlogCitation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialVariant" ADD CONSTRAINT "SocialVariant_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogSnapshot" ADD CONSTRAINT "BlogSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

