-- The cross-app assistant's conversations. Cascaded from Workspace by
-- construction this time, rather than added and fixed later.
CREATE TABLE "AssistantThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantThread_workspaceId_userId_updatedAt_idx" ON "AssistantThread"("workspaceId", "userId", "updatedAt");
CREATE INDEX "AssistantMessage_threadId_createdAt_idx" ON "AssistantMessage"("threadId", "createdAt");

ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
