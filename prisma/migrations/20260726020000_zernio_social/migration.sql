-- Social publishing moves from Unipile to Zernio.
--
-- SocialPostTarget.unipileAccountId is RENAMED rather than dropped and re-added
-- (which is what `prisma migrate diff` generates). The generated form adds a
-- NOT NULL column with no default, so it fails outright on a non-empty table
-- and silently discards the ids on an empty one. A rename is correct either way
-- and preserves history. The column is provider-neutral now, so a future swap
-- won't need another rename.
ALTER TABLE "SocialPostTarget" RENAME COLUMN "unipileAccountId" TO "accountId";
ALTER TABLE "SocialPostTarget" ADD COLUMN "platformPostUrl" TEXT;

-- Zernio's tenant boundary: one profile per workspace, created on first connect.
ALTER TABLE "Workspace" ADD COLUMN "zernioProfileId" TEXT;

-- Zernio reports more than Unipile did; these were simply unavailable before.
ALTER TABLE "SocialSnapshot" ADD COLUMN "reach" INTEGER;
ALTER TABLE "SocialSnapshot" ADD COLUMN "saves" INTEGER;
ALTER TABLE "SocialSnapshot" ADD COLUMN "views" INTEGER;
ALTER TABLE "SocialSnapshot" ALTER COLUMN "source" SET DEFAULT 'zernio';

CREATE TABLE "ZernioAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "profileUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZernioAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ZernioAccount_workspaceId_platform_idx" ON "ZernioAccount"("workspaceId", "platform");
CREATE UNIQUE INDEX "ZernioAccount_workspaceId_accountId_key" ON "ZernioAccount"("workspaceId", "accountId");

ALTER TABLE "ZernioAccount" ADD CONSTRAINT "ZernioAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
