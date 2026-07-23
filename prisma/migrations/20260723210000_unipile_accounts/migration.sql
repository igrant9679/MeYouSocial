-- CreateTable
CREATE TABLE "UnipileAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnipileAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnipileAccount_workspaceId_kind_idx" ON "UnipileAccount"("workspaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "UnipileAccount_workspaceId_accountId_key" ON "UnipileAccount"("workspaceId", "accountId");

-- AddForeignKey
ALTER TABLE "UnipileAccount" ADD CONSTRAINT "UnipileAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

