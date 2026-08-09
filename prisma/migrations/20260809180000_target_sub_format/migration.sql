-- Publish a target as a Story or Reel rather than a feed post.
--
-- Null means the network's own default, which is what every existing row wants:
-- Facebook falls back to a feed post, Instagram picks Reel-or-feed from the
-- media. Only Facebook and Instagram accept an explicit value at all; YouTube
-- auto-detects Shorts from duration and aspect ratio, and TikTok follows the
-- media, so neither has a column value to carry.
ALTER TABLE "SocialPostTarget" ADD COLUMN "subFormat" TEXT;
