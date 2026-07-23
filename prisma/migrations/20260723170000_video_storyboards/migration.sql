-- AlterTable
ALTER TABLE "VideoRender" ADD COLUMN     "scenes" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "srt" TEXT,
ADD COLUMN     "storedUrl" TEXT,
ADD COLUMN     "voiceoverUrl" TEXT;
