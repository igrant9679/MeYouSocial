-- E-VID-06: video is metered in seconds per rendered scene; money only at the operator's prices.
ALTER TABLE "UsageLog" ADD COLUMN "seconds" INTEGER;
ALTER TABLE "VideoRender" ALTER COLUMN "costEstimate" DROP NOT NULL,
ALTER COLUMN "costEstimate" DROP DEFAULT;
-- Every stored estimate came from a guessed $0.75 a second (env VIDEO_COST_PER_SECOND's default): cleared.
UPDATE "VideoRender" SET "costEstimate" = NULL;
