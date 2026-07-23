-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "categories" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "ogDescription" TEXT,
ADD COLUMN     "ogTitle" TEXT,
ADD COLUMN     "publishReport" TEXT,
ADD COLUMN     "publisherNotes" TEXT,
ADD COLUMN     "tags" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "wpPostId" INTEGER;

-- AlterTable
ALTER TABLE "WordPressConnection" ADD COLUMN     "defaultAuthor" TEXT,
ADD COLUMN     "defaultCategories" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "defaultTags" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "publishAsDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seoFieldMap" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "seoPlugin" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "slugRules" TEXT NOT NULL DEFAULT '{}';
