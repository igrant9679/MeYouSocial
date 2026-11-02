-- Chart notes (E-MEA-04).
CREATE TABLE "ChartNote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChartNote_workspaceId_at_idx" ON "ChartNote"("workspaceId", "at");

ALTER TABLE "ChartNote" ADD CONSTRAINT "ChartNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
