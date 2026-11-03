-- E-MEA-08: what people searched to find each page, from Search Console (a rolling 28-day snapshot).
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postId" TEXT,
    "page" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchQuery_workspaceId_page_query_key" ON "SearchQuery"("workspaceId", "page", "query");
CREATE INDEX "SearchQuery_workspaceId_query_idx" ON "SearchQuery"("workspaceId", "query");
CREATE INDEX "SearchQuery_postId_idx" ON "SearchQuery"("postId");

ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
