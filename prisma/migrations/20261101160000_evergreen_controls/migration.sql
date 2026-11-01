-- E-SOC-15: evergreen controls — a recycle cap and rotating text variants.
ALTER TABLE "SocialPost" ADD COLUMN "maxRecycles" INTEGER;
ALTER TABLE "SocialPost" ADD COLUMN "recycleVariants" TEXT NOT NULL DEFAULT '[]';
