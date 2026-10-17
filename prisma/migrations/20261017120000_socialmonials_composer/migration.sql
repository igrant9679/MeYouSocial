-- Socialmonials parity, phase 1 (2026-10-17): first comment (post + per
-- network), move links to the first comment, a logo watermark, and
-- per-network options (TikTok's tiktokSettings). All nullable or defaulted,
-- so every existing post keeps behaving exactly as before.

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "firstComment" TEXT,
ADD COLUMN     "linkToFirstComment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "watermark" TEXT;

-- AlterTable
ALTER TABLE "SocialPostTarget" ADD COLUMN     "firstComment" TEXT,
ADD COLUMN     "options" TEXT;

