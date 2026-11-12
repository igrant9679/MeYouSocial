-- Growth part dc: social and video ideas keep the live discussions they answer (Reach),
-- as JSON [{title, url, source}] — the same shape BlogIdea.evidence has had since part da.
ALTER TABLE "SocialIdea" ADD COLUMN "evidence" TEXT;
ALTER TABLE "Idea" ADD COLUMN "evidence" TEXT;
