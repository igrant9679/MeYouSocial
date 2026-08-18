-- OrgProfile had a bare workspaceId with no foreign key, so deleting a
-- workspace orphaned its profile instead of removing it.
--
-- Orphans must go first: the constraint cannot be added while rows point at
-- workspaces that no longer exist. Every such row is already unreachable —
-- nothing in the app can load a profile whose workspace is gone.
DELETE FROM "OrgProfile" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");

ALTER TABLE "OrgProfile" ADD CONSTRAINT "OrgProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
