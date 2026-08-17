-- Brand context: the facts a generation needs and cannot infer.

-- CreateTable
CREATE TABLE "BrandFact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "subject" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "text" TEXT,
    "extractError" TEXT,
    "chars" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'ready',
    "includeInContext" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandFact_workspaceId_kind_position_idx" ON "BrandFact"("workspaceId", "kind", "position");

-- CreateIndex
CREATE INDEX "BrandDocument_workspaceId_idx" ON "BrandDocument"("workspaceId");

-- AddForeignKey
ALTER TABLE "BrandFact" ADD CONSTRAINT "BrandFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandDocument" ADD CONSTRAINT "BrandDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
