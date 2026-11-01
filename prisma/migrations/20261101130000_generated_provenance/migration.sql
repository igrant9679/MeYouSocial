-- Who wrote generated studio blocks (E-VID-13) and research reports (E-IDE-15)
ALTER TABLE "Script" ADD COLUMN "outlineBy" TEXT;
ALTER TABLE "Script" ADD COLUMN "bodyBy" TEXT;
ALTER TABLE "ResearchSource" ADD COLUMN "writtenBy" TEXT;
ALTER TABLE "ResearchSource" ADD COLUMN "webSources" TEXT;
