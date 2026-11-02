-- A week of engine cycles for the Automation timeline (E-ENG-04).
CREATE TABLE "EngineCycle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skipped" TEXT,
    "budgetReached" BOOLEAN NOT NULL DEFAULT false,
    "activity" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT,

    CONSTRAINT "EngineCycle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngineCycle_workspaceId_at_idx" ON "EngineCycle"("workspaceId", "at");

ALTER TABLE "EngineCycle" ADD CONSTRAINT "EngineCycle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
