-- The block editor's authored content for Company info. `description`
-- remains the plain-text projection every prompt is grounded in.
ALTER TABLE "OrgProfile" ADD COLUMN "descriptionBlocks" TEXT;
