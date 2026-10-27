-- Audit Phase 1, third part (2026-10-27).

-- ART-09: an "Advance anyway" override holds for the body it was given for.
ALTER TABLE "BlogPost" ADD COLUMN "gateOverrideHash" TEXT;
-- Overrides already on record keep holding for the body they cover today.
UPDATE "BlogPost" SET "gateOverrideHash" = md5(coalesce("body", '')) WHERE "gateOverrideAt" IS NOT NULL;

-- ART-08: when auto-review last worked on an article.
ALTER TABLE "BlogPost" ADD COLUMN "autoReviewedAt" TIMESTAMP(3);

-- IDE-02: articles drafted from an idea before the idea's Topic travelled with it.
UPDATE "BlogPost" p
SET "topicId" = i."topicId"
FROM "BlogIdea" i
WHERE i."postId" = p."id" AND p."topicId" IS NULL AND i."topicId" IS NOT NULL;

-- …and the social ideas made from those articles, which landed in "No topic yet".
UPDATE "SocialIdea" s
SET "topicId" = p."topicId"
FROM "BlogPost" p
WHERE s."sourceBlogPostId" = p."id" AND s."topicId" IS NULL AND p."topicId" IS NOT NULL;
