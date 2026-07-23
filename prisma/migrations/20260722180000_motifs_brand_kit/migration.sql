-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "contentTier" INTEGER,
ADD COLUMN     "motifs" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "headingFont" TEXT,
    "bodyFont" TEXT,
    "logoUrl" TEXT,
    "footerCredit" TEXT,
    "toneGuardrails" TEXT,
    "headingSpec" TEXT NOT NULL DEFAULT '{}',
    "featuredImageWidth" INTEGER NOT NULL DEFAULT 1920,
    "featuredImageHeight" INTEGER NOT NULL DEFAULT 1080,
    "ogImageWidth" INTEGER NOT NULL DEFAULT 1200,
    "ogImageHeight" INTEGER NOT NULL DEFAULT 630,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotifDirective" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "rhythm" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotifDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotifDirectiveVersion" (
    "id" TEXT NOT NULL,
    "directiveId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotifDirectiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotifDefault" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tier" INTEGER,
    "audience" TEXT,
    "motifs" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotifDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformMotif" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "motifKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformMotif_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_workspaceId_key" ON "BrandKit"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MotifDirective_workspaceId_key_key" ON "MotifDirective"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "MotifDirectiveVersion_directiveId_version_idx" ON "MotifDirectiveVersion"("directiveId", "version");

-- CreateIndex
CREATE INDEX "MotifDefault_workspaceId_idx" ON "MotifDefault"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMotif_workspaceId_platform_key" ON "PlatformMotif"("workspaceId", "platform");

-- AddForeignKey
ALTER TABLE "MotifDirectiveVersion" ADD CONSTRAINT "MotifDirectiveVersion_directiveId_fkey" FOREIGN KEY ("directiveId") REFERENCES "MotifDirective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

