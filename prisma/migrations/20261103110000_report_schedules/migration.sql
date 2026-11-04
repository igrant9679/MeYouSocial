-- E-MEA-03: a report emailed on a schedule to named members of the workspace.
-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL DEFAULT 1,
    "monthDay" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 9,
    "recipients" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_nextAt_idx" ON "ReportSchedule"("enabled", "nextAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_workspaceId_reportKey_idx" ON "ReportSchedule"("workspaceId", "reportKey");

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

