// Intel seed — ~12 channels × 8 videos each, with computed outlier/velocity
// scores so the Intel UI (MU-02) has plausible data even in mock mode.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CHANNELS = [
  { handle: "@deepwork-craft",   name: "Deep Work Craft",     subs: 245_000, lang: "en", category: "Education" },
  { handle: "@productivity-lab", name: "Productivity Lab",    subs: 1_240_000, lang: "en", category: "Education" },
  { handle: "@calmpod",          name: "Calm Pod",            subs: 87_000, lang: "en", category: "Lifestyle" },
  { handle: "@signalfeed",       name: "Signal Feed",         subs: 412_000, lang: "en", category: "Tech" },
  { handle: "@frame-by-frame",   name: "Frame by Frame",      subs: 68_500, lang: "en", category: "Film" },
  { handle: "@founder-diary",    name: "Founder Diary",       subs: 156_000, lang: "en", category: "Business" },
  { handle: "@cite-the-paper",   name: "Cite the Paper",      subs: 33_400, lang: "en", category: "Science" },
  { handle: "@money-mechanics",  name: "Money Mechanics",     subs: 692_000, lang: "en", category: "Finance" },
  { handle: "@build-the-thing",  name: "Build the Thing",     subs: 19_800, lang: "en", category: "Tech" },
  { handle: "@quiet-creator",    name: "Quiet Creator",       subs: 45_900, lang: "en", category: "Lifestyle" },
  { handle: "@ai-explained-eli5", name: "AI Explained ELI5",  subs: 880_000, lang: "en", category: "Tech" },
  { handle: "@long-form-only",   name: "Long Form Only",      subs: 124_000, lang: "en", category: "Education" },
];

const TITLE_TEMPLATES = [
  "Why everything you know about {topic} is wrong",
  "I tried {topic} for 30 days — here's what happened",
  "The {topic} trap nobody talks about",
  "Stop doing {topic}. Do this instead.",
  "The hidden cost of {topic}",
  "{topic}: the part nobody explains",
  "Inside the {topic} algorithm",
  "Most {topic} advice is dangerous",
  "What experts get wrong about {topic}",
  "The 80/20 of {topic}",
  "How I doubled my {topic} in 6 months",
  "The {topic} mistake I'll never make again",
];

const TOPICS = ["productivity", "habits", "focus", "income", "writing", "filmmaking", "AI", "investing", "wellness", "leadership"];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

async function main() {
  for (const c of CHANNELS) {
    const ch = await db.intelChannel.upsert({
      where: { youtubeId: "UC_" + c.handle.replace(/[^a-z0-9]+/gi, "_") },
      update: {},
      create: {
        youtubeId: "UC_" + c.handle.replace(/[^a-z0-9]+/gi, "_"),
        handle: c.handle,
        name: c.name,
        subscribers: c.subs,
        totalViews: BigInt(Math.round(c.subs * (40 + (hash(c.handle) % 80)))),
        videoCount: 80 + (hash(c.handle) % 250),
        uploadFrequency: 0.5 + (hash(c.handle) % 30) / 10,
        velocityScore: Math.round(((hash(c.handle) % 90) / 10 + 0.5) * 10) / 10,
        language: c.lang,
        category: c.category,
        lastIndexedAt: new Date(),
      },
    });

    // Generate 8 videos for this channel
    const videos = Array.from({ length: 8 }, (_, i) => {
      const seed = hash(c.handle + i);
      const topic = TOPICS[seed % TOPICS.length];
      const title = TITLE_TEMPLATES[seed % TITLE_TEMPLATES.length].replace("{topic}", topic);
      const baseViews = c.subs * (0.05 + (seed % 30) / 100);
      const multiplier = ((seed % 100) / 12) - 1; // -1..+7
      const views = Math.max(500, Math.round(baseViews * Math.exp(multiplier / 3)));
      const isShort = seed % 7 === 0;
      return {
        youtubeId: "yt_" + c.handle.replace(/[^a-z0-9]+/gi, "") + "_" + i,
        title,
        publishedAt: new Date(Date.now() - i * 5 * 24 * 60 * 60 * 1000),
        durationSeconds: isShort ? 45 : 600 + (seed % 1200),
        views,
        likes: Math.round(views * 0.03),
        comments: Math.round(views * 0.005),
        format: isShort ? "short" : "long",
      };
    });

    // Compute outlier score for each (views ÷ average of others on same channel)
    const avg = videos.reduce((a, v) => a + v.views, 0) / videos.length;
    for (const v of videos) {
      await db.intelVideo.upsert({
        where: { youtubeId: v.youtubeId },
        update: {},
        create: {
          intelChannelId: ch.id,
          youtubeId: v.youtubeId,
          title: v.title,
          publishedAt: v.publishedAt,
          durationSeconds: v.durationSeconds,
          views: BigInt(v.views),
          likes: v.likes,
          comments: v.comments,
          format: v.format,
          outlierScore: Math.round((v.views / Math.max(1, avg)) * 10) / 10,
          viewsPerSub: Math.round((v.views / Math.max(1, c.subs)) * 100) / 100,
        },
      });
    }
  }
  console.log(`✓ Intel seeded: ${CHANNELS.length} channels × 8 videos`);
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
