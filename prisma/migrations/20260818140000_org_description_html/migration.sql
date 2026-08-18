-- The Company info editor is rich text now, not blocks. The column had no
-- rows anywhere (checked on prod before the rename), so this is a rename
-- rather than an add-and-abandon: `description` stays the plain-text
-- projection every prompt is grounded in.
ALTER TABLE "OrgProfile" RENAME COLUMN "descriptionBlocks" TO "descriptionHtml";
