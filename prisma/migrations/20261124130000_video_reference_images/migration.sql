-- Reference images for a video board (2026-11-24, Gemini Omni Flash): up to six stored pictures of a person,
-- character or product that every scene keeps looking the same. JSON array of storage keys.

ALTER TABLE "VideoRender" ADD COLUMN "referenceKeys" TEXT NOT NULL DEFAULT '[]';
