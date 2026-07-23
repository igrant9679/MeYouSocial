-- CreateTable
CREATE TABLE "ReportConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "dateRangeDays" INTEGER NOT NULL DEFAULT 56,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportConfig_workspaceId_key_key" ON "ReportConfig"("workspaceId", "key");
