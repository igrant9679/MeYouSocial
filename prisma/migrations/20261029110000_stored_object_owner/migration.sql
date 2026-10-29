-- CreateTable
CREATE TABLE "StoredObject" (
    "key" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "StoredObject_workspaceId_idx" ON "StoredObject"("workspaceId");

-- AddForeignKey
ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
