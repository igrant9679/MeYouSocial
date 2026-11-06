-- SOC-04 / E-SOC-01: a draft a person parked is never auto-queued.
ALTER TABLE "SocialPost" ADD COLUMN "heldAt" TIMESTAMP(3),
ADD COLUMN "heldById" TEXT;
