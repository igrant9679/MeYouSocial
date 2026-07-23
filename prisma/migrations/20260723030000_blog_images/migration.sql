-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "aiImagesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "brandInBodyImages" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireImagesToPublish" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "BlogImage" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'url',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "branded" BOOLEAN NOT NULL DEFAULT false,
    "brief" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogImage_postId_role_key" ON "BlogImage"("postId", "role");

-- AddForeignKey
ALTER TABLE "BlogImage" ADD CONSTRAINT "BlogImage_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
