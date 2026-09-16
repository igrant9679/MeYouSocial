-- The first backfill (20260916150000) rounded viewsPerHour to two decimals,
-- which stored a ten-view video from 2023 as 0 — a measured rate turned into
-- a zero. Recompute every row at full precision; the display does the
-- rounding ("<0.1" for the long tail).
UPDATE "IntelVideo"
SET "viewsPerHour" = "views"::double precision / GREATEST(1.0, EXTRACT(EPOCH FROM ("createdAt" - "publishedAt")) / 3600.0)
WHERE "views" IS NOT NULL AND "publishedAt" IS NOT NULL AND "createdAt" > "publishedAt";
