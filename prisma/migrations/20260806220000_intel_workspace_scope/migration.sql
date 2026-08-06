-- Intel becomes workspace-scoped: the install-wide research index leaked one
-- tenant's competitive research to another's users. Existing rows are
-- attributed to the original research workspace (LSI Media on this install,
-- falling back to the oldest workspace if that id is ever absent); a
-- post-deploy pass re-homes tenant-specific rows.

ALTER TABLE "IntelChannel" ADD COLUMN "workspaceId" TEXT;

UPDATE "IntelChannel" SET "workspaceId" = COALESCE(
  (SELECT "id" FROM "Workspace" WHERE "id" = 'cmrvqpm3i0000vq8k9lbzzwrb'),
  (SELECT "id" FROM "Workspace" ORDER BY "createdAt" ASC LIMIT 1)
);

ALTER TABLE "IntelChannel" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "IntelChannel" ADD CONSTRAINT "IntelChannel_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "IntelChannel_youtubeId_key";
CREATE UNIQUE INDEX "IntelChannel_workspaceId_youtubeId_key" ON "IntelChannel"("workspaceId", "youtubeId");
CREATE INDEX "IntelChannel_workspaceId_idx" ON "IntelChannel"("workspaceId");

DROP INDEX "IntelVideo_youtubeId_key";
CREATE UNIQUE INDEX "IntelVideo_intelChannelId_youtubeId_key" ON "IntelVideo"("intelChannelId", "youtubeId");
