-- E-SOC-08: a video's length and size, measured when it's stored.
-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

