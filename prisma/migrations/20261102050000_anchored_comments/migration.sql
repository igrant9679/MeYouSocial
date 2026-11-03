-- E-ART-15: anchored review comments — mentions, who resolved, and the approval hold.
ALTER TABLE "BlogComment" ADD COLUMN "mentionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "resolvedById" TEXT,
ADD COLUMN "resolvedAt" TIMESTAMP(3);

ALTER TABLE "BrandKit" ADD COLUMN "blockOnOpenComments" BOOLEAN NOT NULL DEFAULT false;
