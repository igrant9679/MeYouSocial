-- Search volume / competition on the keyword strategy, fetched from a real
-- search-data provider (DataForSEO or Keywords Everywhere). Null means "not
-- fetched", never zero — the page renders a dash with the reason.
ALTER TABLE "Keyword" ADD COLUMN "volume" INTEGER;
ALTER TABLE "Keyword" ADD COLUMN "cpc" DOUBLE PRECISION;
ALTER TABLE "Keyword" ADD COLUMN "competition" DOUBLE PRECISION;
ALTER TABLE "Keyword" ADD COLUMN "trend" TEXT;
ALTER TABLE "Keyword" ADD COLUMN "volumeSource" TEXT;
ALTER TABLE "Keyword" ADD COLUMN "volumeAt" TIMESTAMP(3);
