-- Socialmonials parity, phase 2 (2026-10-17): where a post came from, for the
-- Queue / Sent / Drafts Source filter. Null on older rows; derived in code.

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "source" TEXT;

