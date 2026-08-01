-- Durable background jobs. Replaces an in-memory Map that lost every queued and
-- running job on each redeploy, with no trace and no way for a caller to tell
-- "still working" from "died". See the note on model Job in schema.prisma.

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'queued',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "lastLog" TEXT,
    "refId" TEXT,
    "workspaceId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- The sweeper's claim scan: oldest queued first.
CREATE INDEX "Job_state_createdAt_idx" ON "Job"("state", "createdAt");

-- "How did the <name> job for this entity end?" — used by the onboarding wizard
-- so a failed job renders as failed instead of an eternal "Generating…".
CREATE INDEX "Job_name_refId_createdAt_idx" ON "Job"("name", "refId", "createdAt");
