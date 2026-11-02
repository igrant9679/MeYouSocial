-- RSS filters and defaults (E-SOC-20): include/exclude words, the item's image, default accounts.
ALTER TABLE "RssFeed" ADD COLUMN "includeWords" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN "excludeWords" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN "useImage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RssFeed" ADD COLUMN "accountIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "RssItem" ADD COLUMN "skipped" TEXT;
