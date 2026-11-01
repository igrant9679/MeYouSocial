-- Public submission form controls (E-SET-08)
ALTER TABLE "Channel" ADD COLUMN "submissionsOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Channel" ADD COLUMN "submitSlug" TEXT;
CREATE UNIQUE INDEX "Channel_submitSlug_key" ON "Channel"("submitSlug");
