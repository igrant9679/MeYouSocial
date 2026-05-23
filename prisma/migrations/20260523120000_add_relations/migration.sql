-- Add the two missing FK relations: Asset -> Channel, ProjectAssignee -> User.
-- Underlying columns already exist; only the constraints are new.

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAssignee"
  ADD CONSTRAINT "ProjectAssignee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiDoc"
  ADD CONSTRAINT "WikiDoc_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
