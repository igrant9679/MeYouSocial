-- Video assembly: the storyboard's clips stitched into one deliverable file.
ALTER TABLE "VideoRender" ADD COLUMN "assembledUrl" TEXT;
ALTER TABLE "VideoRender" ADD COLUMN "assemblyStatus" TEXT;
ALTER TABLE "VideoRender" ADD COLUMN "assemblyError" TEXT;
