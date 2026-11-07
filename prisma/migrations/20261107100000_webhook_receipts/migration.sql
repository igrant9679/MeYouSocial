-- Audit SOC-15: a Zernio post event is handled once, and an older one arriving
-- late doesn't overwrite a newer state.

ALTER TABLE "SocialPostTarget" ADD COLUMN "providerEventAt" TIMESTAMP(3);

CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookReceipt_source_eventId_key" ON "WebhookReceipt"("source", "eventId");
CREATE INDEX "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");
