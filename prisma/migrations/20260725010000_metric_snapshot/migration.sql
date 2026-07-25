-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "sample" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL DEFAULT 'none',
    "source" TEXT NOT NULL DEFAULT 'owned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricSnapshot_workspaceId_key_day_idx" ON "MetricSnapshot"("workspaceId", "key", "day");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_workspaceId_day_key_key" ON "MetricSnapshot"("workspaceId", "day", "key");

