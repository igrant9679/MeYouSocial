-- E-VID-08: captions timed to the voice, burned in on request; a voice per channel.
-- AlterTable
ALTER TABLE "VideoRender" ADD COLUMN     "burnCaptions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captionsBurned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captionsTimedBy" TEXT,
ADD COLUMN     "narrationSource" TEXT,
ADD COLUMN     "voiceId" TEXT,
ADD COLUMN     "voiceWords" TEXT;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "voiceId" TEXT;

