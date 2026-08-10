-- Inbox events pushed by Zernio (comments, DMs, new conversations).
--
-- These were already being delivered: both tenants' webhook subscriptions have
-- listed comment.received / message.received / conversation.started since they
-- were created, and the handler answered 200 while ignoring them — so Zernio
-- saw a healthy endpoint and every event was dropped. This table is where they
-- land now.
--
-- Deliberately thin: a pointer plus a preview, not a mirror of the thread.
-- Engage still reads conversations and comments live from Zernio; this only
-- answers "what arrived since I last looked", which a live fetch cannot.
CREATE TABLE "SocialInboxEvent" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "eventId"     TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "platform"    TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "threadId"    TEXT,
  "authorName"  TEXT,
  "preview"     TEXT,
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"      TIMESTAMP(3),

  CONSTRAINT "SocialInboxEvent_pkey" PRIMARY KEY ("id")
);

-- Zernio redelivers on failure; the same event must never count twice.
CREATE UNIQUE INDEX "SocialInboxEvent_workspaceId_eventId_key"
  ON "SocialInboxEvent"("workspaceId", "eventId");

CREATE INDEX "SocialInboxEvent_workspaceId_readAt_idx"
  ON "SocialInboxEvent"("workspaceId", "readAt");

ALTER TABLE "SocialInboxEvent"
  ADD CONSTRAINT "SocialInboxEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
