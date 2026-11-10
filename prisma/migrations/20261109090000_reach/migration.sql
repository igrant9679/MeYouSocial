-- Reach: live sources for search, reading, research and ideas (the hosted port
-- of the Agent-Reach toolkit).

-- What an article idea was drawn from: [{title, url, source}] as JSON.
ALTER TABLE "BlogIdea" ADD COLUMN "evidence" TEXT;

CREATE TABLE "ReachHealth" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "okAt" TIMESTAMP(3),
    "failAt" TIMESTAMP(3),
    "error" TEXT,
    "via" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReachHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReachHealth_workspaceId_channel_key" ON "ReachHealth"("workspaceId", "channel");

ALTER TABLE "ReachHealth" ADD CONSTRAINT "ReachHealth_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
