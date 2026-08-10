-- A reply written in Engage but not sent.
--
-- Every other reply in Engage publishes the moment it succeeds: no queue, no
-- approval gate, no undo. That makes a public answer the one thing in this app
-- that cannot be re-read tomorrow before it exists in the world — which is
-- exactly what a years-old customer review deserves. This table is that pause.
--
-- It is NOT a send queue. Nothing here is ever dispatched by a sweep; a draft
-- becomes a reply only when a person presses Send. A forgotten draft therefore
-- stays silent forever, rather than surprising a customer months later.
CREATE TABLE "InboxReplyDraft" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "targetId"    TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "message"     TEXT NOT NULL,
  "authorId"    TEXT,
  "authorName"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InboxReplyDraft_pkey" PRIMARY KEY ("id")
);

-- One draft per thing being answered: saving again edits the draft in place,
-- so two people cannot end up with rival answers to the same review.
CREATE UNIQUE INDEX "InboxReplyDraft_workspaceId_kind_targetId_key"
  ON "InboxReplyDraft"("workspaceId", "kind", "targetId");

CREATE INDEX "InboxReplyDraft_workspaceId_kind_idx"
  ON "InboxReplyDraft"("workspaceId", "kind");

ALTER TABLE "InboxReplyDraft"
  ADD CONSTRAINT "InboxReplyDraft_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
