-- E-ENG-13: files are read, and big ones come up in pieces.
-- AlterTable
ALTER TABLE "ResearchSource" ADD COLUMN     "bytes" BIGINT,
ADD COLUMN     "readNote" TEXT,
ADD COLUMN     "readState" TEXT NOT NULL DEFAULT 'ready';

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "scriptId" TEXT,
    "chatId" TEXT,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "received" BIGINT NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "remote" TEXT,
    "storedKey" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadSession_workspaceId_userId_fingerprint_idx" ON "UploadSession"("workspaceId", "userId", "fingerprint");

-- CreateIndex
CREATE INDEX "UploadSession_updatedAt_idx" ON "UploadSession"("updatedAt");

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The stand-in sentence that used to be stored for a PDF or Word file reached the
-- model as research (ENG-14); those files, and any that stored nothing, go to be read.
UPDATE "ResearchSource"
SET "content" = NULL, "wordCount" = 0, "readState" = 'unread'
WHERE "kind" IN ('pdf', 'word') AND "content" LIKE '(% attachment "%text extraction is stubbed%';

UPDATE "ResearchSource"
SET "readState" = 'unread'
WHERE "kind" IN ('pdf', 'word', 'text', 'image') AND "content" IS NULL;
