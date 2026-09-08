-- An admin's explicit override of an article's required checks ("Advance
-- anyway" on the held-article card). Recorded with who, when and why; while
-- set, the gates count as satisfied for advancing and publishing that post.
ALTER TABLE "BlogPost" ADD COLUMN "gateOverrideAt" TIMESTAMP(3);
ALTER TABLE "BlogPost" ADD COLUMN "gateOverrideById" TEXT;
ALTER TABLE "BlogPost" ADD COLUMN "gateOverrideReason" TEXT;
