-- Optimize findings as actionable cards (One-Loop redesign, step 1):
-- E-E-A-T / content-gap / entity-coverage output with a kind and a state, so
-- a dismissed finding is never re-raised for that article. Cascaded from
-- Workspace and BlogPost by construction.
CREATE TABLE "BlogFinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "proposal" TEXT,
    "anchor" TEXT,
    "questions" TEXT NOT NULL DEFAULT '[]',
    "answers" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    CONSTRAINT "BlogFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogFinding_postId_fingerprint_key" ON "BlogFinding"("postId", "fingerprint");
CREATE INDEX "BlogFinding_workspaceId_status_idx" ON "BlogFinding"("workspaceId", "status");

ALTER TABLE "BlogFinding" ADD CONSTRAINT "BlogFinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogFinding" ADD CONSTRAINT "BlogFinding_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
