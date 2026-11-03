-- E-ENG-07: what each AI call was for, and each assistant reply's tokens.
ALTER TABLE "UsageLog" ADD COLUMN "purpose" TEXT;
ALTER TABLE "AssistantMessage" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "AssistantMessage" ADD COLUMN "outputTokens" INTEGER;
