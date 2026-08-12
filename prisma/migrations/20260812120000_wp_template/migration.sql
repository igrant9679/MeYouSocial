-- WordPress theme post-template for published articles (REST `template` field,
-- e.g. "template-fullwidth.php"). Empty = the theme's default single-post
-- template — which is what every existing connection was already getting.
ALTER TABLE "WordPressConnection" ADD COLUMN "template" TEXT NOT NULL DEFAULT '';
