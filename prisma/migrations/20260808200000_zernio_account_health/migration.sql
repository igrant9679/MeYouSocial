-- Token health for connected social accounts, mirrored from Zernio on reconcile.
--
-- Motivation: CommunityForce's Facebook token died twice on 2026-08-07 and both
-- times it was discovered by a post FAILING. Zernio exposes the state that would
-- have caught it in advance (needsReconnection, platformStatus), so mirror it.
--
-- NOTE tokenExpiresAt is stored for display, not for alerting: X and YouTube
-- access tokens legitimately sit minutes from expiry because Zernio refreshes
-- them.
ALTER TABLE "ZernioAccount"
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "needsReconnection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "platformStatus" TEXT,
  ADD COLUMN "platformStatusReason" TEXT,
  ADD COLUMN "intentionalDisconnectAt" TIMESTAMP(3),
  ADD COLUMN "healthCheckedAt" TIMESTAMP(3);
