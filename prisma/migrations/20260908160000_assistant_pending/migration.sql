-- The assistant proposes outward-facing or hard-to-undo actions and waits
-- for the person to confirm in the chat; the proposal lives on the thread.
ALTER TABLE "AssistantThread" ADD COLUMN "pending" TEXT;
