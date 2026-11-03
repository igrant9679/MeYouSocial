-- E-ENG-12: Stop on an assistant turn that is running.
ALTER TABLE "AssistantThread" ADD COLUMN "stopRequestedAt" TIMESTAMP(3);
