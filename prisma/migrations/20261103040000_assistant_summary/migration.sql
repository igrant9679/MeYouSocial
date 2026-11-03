-- E-ENG-08: a running summary of what scrolled out of the assistant's window.
ALTER TABLE "AssistantThread" ADD COLUMN "summary" TEXT;
ALTER TABLE "AssistantThread" ADD COLUMN "summaryThrough" TIMESTAMP(3);
ALTER TABLE "AssistantThread" ADD COLUMN "summaryOutside" BOOLEAN NOT NULL DEFAULT false;
