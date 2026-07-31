-- Make the YouTube Data API key a PLATFORM key, shared by every workspace.
--
-- The Data API key is not bound to a channel: every call that uses it
-- (findChannel / listVideos / searchChannels) passes the channel as an argument
-- and hits a public endpoint, so one key serves all tenants. The channel-OWNED
-- half (youtube_oauth:*) stays per-workspace and is deliberately untouched here.
--
-- This must run WITH the code change, not after it: getSetting() now skips the
-- WorkspaceSetting layer for api_key:youtube, so the existing per-workspace row
-- stops being read the moment that deploys. Promoting the value here keeps
-- YouTube lookups working across the cutover instead of going dark.

-- 1. Promote the existing key to the shared platform row. Most-recently-updated
--    wins if more than one workspace ever set one. DO NOTHING so a platform row
--    that already exists is authoritative and a re-run is a no-op.
INSERT INTO "Setting" ("key", "value", "updatedAt")
SELECT 'api_key:youtube', ws."value", NOW()
FROM "WorkspaceSetting" ws
WHERE ws."key" = 'api_key:youtube' AND ws."value" <> ''
ORDER BY ws."updatedAt" DESC
LIMIT 1
ON CONFLICT ("key") DO NOTHING;

-- 2. Drop the now-unread per-workspace rows. They would be inert either way,
--    but leaving them in the DB reads as "this tenant has its own key" to
--    anyone auditing later.
DELETE FROM "WorkspaceSetting" WHERE "key" = 'api_key:youtube';
