-- Internal-link inventory (E-ART-12): where a site page came from and the links it had when read.
ALTER TABLE "SitePage" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "SitePage" ADD COLUMN "linksTo" TEXT;
ALTER TABLE "SitePage" ADD COLUMN "crawledAt" TIMESTAMP(3);
