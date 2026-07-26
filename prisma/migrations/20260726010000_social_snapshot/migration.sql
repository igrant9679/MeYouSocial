-- CreateTable
CREATE TABLE "SocialSnapshot" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'unipile',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialSnapshot_targetId_idx" ON "SocialSnapshot"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSnapshot_targetId_capturedAt_key" ON "SocialSnapshot"("targetId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SocialSnapshot" ADD CONSTRAINT "SocialSnapshot_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "SocialPostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

