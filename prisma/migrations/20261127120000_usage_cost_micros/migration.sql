-- OpenRouter as a text AI provider (2026-11-27): OpenRouter reports what each call cost
-- (`usage.cost`, USD). Kept in millionths of a USD, beside the tokens; null for every other provider.
ALTER TABLE "UsageLog" ADD COLUMN "costMicros" INTEGER;
