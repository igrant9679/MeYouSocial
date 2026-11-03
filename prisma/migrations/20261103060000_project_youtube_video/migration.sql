-- E-MEA-17: a production project carries its own YouTube upload.
ALTER TABLE "ContentProject" ADD COLUMN "youtubeVideoId" TEXT;
