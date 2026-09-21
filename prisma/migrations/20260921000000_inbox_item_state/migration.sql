-- Engage items gained a second local state. The table held "set aside" only;
-- it now also holds "read", so the Prisma model is SocialInboxItemState while
-- the table keeps its original name (see the @@map note in schema.prisma).
--
-- DEFAULT 'aside' is what makes this safe on existing rows: every row written
-- before today meant exactly that, so the backfill is the default.
ALTER TABLE "SocialInboxDismissal" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'aside';
