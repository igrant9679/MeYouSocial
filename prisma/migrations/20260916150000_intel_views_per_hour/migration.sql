-- Views per hour on indexed Intel videos: views ÷ hours between publish and
-- the measurement. Existing rows are backfilled from the views they hold and
-- the moment they were indexed (createdAt) — the sync never re-reads views,
-- so that IS when the figure was measured. Null where the maths can't be done.
ALTER TABLE "IntelVideo" ADD COLUMN "viewsPerHour" DOUBLE PRECISION;

UPDATE "IntelVideo"
SET "viewsPerHour" = ROUND(
  ("views"::double precision / GREATEST(1.0, EXTRACT(EPOCH FROM ("createdAt" - "publishedAt")) / 3600.0))::numeric, 2
)::double precision
WHERE "views" IS NOT NULL AND "publishedAt" IS NOT NULL AND "createdAt" > "publishedAt";
