-- Every workspace-scoped table below carried a bare `workspaceId` with no
-- foreign key, so deleting a workspace left its rows behind forever. Same fix
-- as OrgProfile got in 20260818160000, for the remaining twenty.
--
-- ⚠ AuditLog is DELIBERATELY NOT HERE. Cascading it would destroy a
-- workspace's audit history along with the workspace, which is a retention
-- decision rather than a cleanup. Its 13 orphan rows stay.
--
-- Orphans are removed first because Postgres will not add the constraint while
-- rows point at workspaces that no longer exist. Measured on production before
-- writing this: 21 MotifDirective, 120 MetricSnapshot and 5 Recommendation
-- rows, all belonging to workspaces that are already gone and unreachable by
-- every query in the app. Every other table was already clean.

-- Keyword
DELETE FROM "Keyword" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SitePage
DELETE FROM "SitePage" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BrandKit
DELETE FROM "BrandKit" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MotifDirective
DELETE FROM "MotifDirective" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "MotifDirective" ADD CONSTRAINT "MotifDirective_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MotifDefault
DELETE FROM "MotifDefault" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "MotifDefault" ADD CONSTRAINT "MotifDefault_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PlatformMotif
DELETE FROM "PlatformMotif" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "PlatformMotif" ADD CONSTRAINT "PlatformMotif_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SmeProfile
DELETE FROM "SmeProfile" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "SmeProfile" ADD CONSTRAINT "SmeProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BlogIdea
DELETE FROM "BlogIdea" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "BlogIdea" ADD CONSTRAINT "BlogIdea_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WordPressConnection
DELETE FROM "WordPressConnection" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "WordPressConnection" ADD CONSTRAINT "WordPressConnection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FunctionMode
DELETE FROM "FunctionMode" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "FunctionMode" ADD CONSTRAINT "FunctionMode_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification
DELETE FROM "Notification" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NotificationPreference
DELETE FROM "NotificationPreference" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ContentAuditItem
DELETE FROM "ContentAuditItem" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "ContentAuditItem" ADD CONSTRAINT "ContentAuditItem_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReportConfig
DELETE FROM "ReportConfig" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "ReportConfig" ADD CONSTRAINT "ReportConfig_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AutomationState
DELETE FROM "AutomationState" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "AutomationState" ADD CONSTRAINT "AutomationState_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- VideoRender
DELETE FROM "VideoRender" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "VideoRender" ADD CONSTRAINT "VideoRender_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BrandedShort
DELETE FROM "BrandedShort" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "BrandedShort" ADD CONSTRAINT "BrandedShort_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MetricSnapshot
DELETE FROM "MetricSnapshot" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recommendation
DELETE FROM "Recommendation" WHERE "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Job
DELETE FROM "Job" WHERE "workspaceId" IS NOT NULL AND "workspaceId" NOT IN (SELECT "id" FROM "Workspace");
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
