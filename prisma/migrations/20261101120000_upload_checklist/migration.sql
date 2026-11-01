-- Upload checklist per production project (E-VID-04)
ALTER TABLE "ContentProject" ADD COLUMN "uploadChecklist" TEXT NOT NULL DEFAULT '{}';
