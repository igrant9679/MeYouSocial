-- Audit ENG-22: a retried job keeps the steps it finished, and one thing has at
-- most one live job.

-- Steps an attempt finished, as JSON {step: result} (ctx.once).
ALTER TABLE "Job" ADD COLUMN "steps" TEXT;

-- Two live jobs for the same thing already waiting would stop the index below
-- from being made: keep the oldest (a running one first) and close the others.
UPDATE "Job" AS j
SET "state" = 'failed',
    "error" = 'A second copy of a job already waiting for the same thing — closed when duplicate jobs were stopped.',
    "finishedAt" = NOW(),
    "claimedAt" = NULL,
    "claimedBy" = NULL
WHERE j."state" IN ('queued', 'running')
  AND j."refId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Job" AS k
    WHERE k."name" = j."name"
      AND k."refId" = j."refId"
      AND k."state" IN ('queued', 'running')
      AND k."id" <> j."id"
      AND (
        (k."state" = 'running' AND j."state" = 'queued')
        OR (k."state" = j."state" AND (k."createdAt" < j."createdAt" OR (k."createdAt" = j."createdAt" AND k."id" < j."id")))
      )
  );

-- One live job per (name, refId). Prisma's schema can't express a partial
-- index, so it lives here only; enqueue() reads it as "already queued".
CREATE UNIQUE INDEX "Job_live_once" ON "Job" ("name", "refId")
WHERE "state" IN ('queued', 'running') AND "refId" IS NOT NULL;
