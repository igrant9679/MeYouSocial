-- Intel figures carry when they were read; YouTube searches are cached (audit IDE-11, IDE-13).
ALTER TABLE "IntelVideo" ADD COLUMN "measuredAt" TIMESTAMP(3);

CREATE TABLE "ApiCache" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCache_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ApiCache_expiresAt_idx" ON "ApiCache"("expiresAt");
