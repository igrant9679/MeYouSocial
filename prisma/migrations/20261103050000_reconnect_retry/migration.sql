-- E-SOC-07: a failed leg can wait for its account to be reconnected, then go again.
ALTER TABLE "SocialPostTarget" ADD COLUMN "retryOnReconnectAt" TIMESTAMP(3);
ALTER TABLE "SocialPostTarget" ADD COLUMN "retryOnReconnectBy" TEXT;
