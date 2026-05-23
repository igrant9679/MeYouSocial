-- Per-channel thumbnail config + optional soft limit. JSON-as-text per DECISIONS.md.
ALTER TABLE "Channel" ADD COLUMN "thumbnailConfig" TEXT;
ALTER TABLE "Channel" ADD COLUMN "limitThumbnailsPerMonth" INTEGER;
