-- Post templates (E-SOC-23).
CREATE TABLE "SocialTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "firstComment" TEXT,
    "category" TEXT,
    "mediaKeys" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialTemplate_workspaceId_idx" ON "SocialTemplate"("workspaceId");

ALTER TABLE "SocialTemplate" ADD CONSTRAINT "SocialTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
