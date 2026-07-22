// Seeds: built-in templates, a demo workspace + admin user,
// a sample channel with voice/audience/ideas so the app shows real data on first run.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const LONG_TEMPLATES = [
  { name: "Flexible", structure: { sections: ["Hook", "Body", "Conclusion"], notes: "Free-form. AI decides pacing." } },
  { name: "Educational (WHY-WHAT-HOW)", structure: { sections: ["Why it matters", "What it is", "How to do it"] } },
  { name: "Documentary (3-act)", structure: { sections: ["Setup", "Confrontation", "Resolution"] } },
  { name: "Explainer", structure: { sections: ["Question", "Mechanism", "Implication"] } },
  { name: "Commentary (O-I-E)", structure: { sections: ["Observation", "Insight", "Evidence"] } },
  { name: "Review (C-F-V)", structure: { sections: ["Context", "Finding", "Verdict"] } },
  { name: "Compilation", structure: { sections: ["Intro", "Curated items", "Wrap"] } },
  { name: "Fictional Story (3-act)", structure: { sections: ["Setup", "Conflict", "Resolution"] } },
  { name: "VSL (P-A-S)", structure: { sections: ["Problem", "Agitation", "Solution"] } },
  { name: "Listicle", structure: { sections: ["Intro", "Items", "Best pick"] } },
  { name: "Essay (thesis)", structure: { sections: ["Thesis", "Arguments", "Conclusion"] } },
  { name: "News (inverted pyramid)", structure: { sections: ["Lede", "Details", "Background"] } },
  { name: "Experiment", structure: { sections: ["Question", "Test", "Result"] } },
  { name: "Challenge", structure: { sections: ["Premise", "Attempts", "Outcome"] } },
];

const SHORT_TEMPLATES = [
  { name: "Shorts Educational" },
  { name: "Shorts Review" },
  { name: "Shorts Story" },
  { name: "Shorts Viral" },
  { name: "Shorts Ad" },
];

async function seedTemplates() {
  for (const t of LONG_TEMPLATES) {
    await db.template.upsert({
      where: { id: "global-" + t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
      update: {},
      create: {
        id: "global-" + t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: t.name,
        kind: "long",
        source: "built-in",
        structure: JSON.stringify(t.structure),
      },
    });
  }
  for (const t of SHORT_TEMPLATES) {
    await db.template.upsert({
      where: { id: "global-" + t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
      update: {},
      create: {
        id: "global-" + t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: t.name,
        kind: "short",
        source: "built-in",
        structure: JSON.stringify({ sections: ["Hook", "Beat", "Payoff"] }),
      },
    });
  }
}

async function seedDemoData() {
  const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "you@example.com").toLowerCase();
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "meyousocial-dev", 10);

  // Account recovery. The seed runs on every boot, so it must NOT rewrite the
  // password by default — that would silently undo any in-app password change.
  // Set RESET_ADMIN=true (plus SEED_ADMIN_PASSWORD) for exactly one deploy to
  // recover a locked-out owner, then remove the flag.
  const resetRequested = process.env.RESET_ADMIN === "true";

  const user = await db.user.upsert({
    where: { email: adminEmail },
    update: resetRequested ? { passwordHash } : {},
    create: { email: adminEmail, name: "MeYouSocial Admin", passwordHash },
  });

  const workspace = await db.workspace.upsert({
    where: { id: "demo-workspace" },
    update: {},
    create: { id: "demo-workspace", name: "Demo Workspace", defaultModel: "claude-sonnet" },
  });

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "ADMIN" },
    create: { userId: user.id, workspaceId: workspace.id, role: "ADMIN" },
  });

  // On an explicit recovery, make sure the owner is an active ADMIN of EVERY
  // workspace — role checks are workspace-scoped, so ADMIN on the demo
  // workspace alone wouldn't unlock real channels living elsewhere.
  if (resetRequested) {
    const all = await db.workspace.findMany({ select: { id: true } });
    for (const w of all) {
      await db.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: w.id } },
        update: { role: "ADMIN", status: "active" },
        create: { userId: user.id, workspaceId: w.id, role: "ADMIN", status: "active" },
      });
    }
    console.log(`↻ RESET_ADMIN: reset password + granted ADMIN on ${all.length} workspace(s) for ${adminEmail}`);
  }

  const channel = await db.channel.upsert({
    where: { id: "demo-channel" },
    update: {},
    create: {
      id: "demo-channel",
      workspaceId: workspace.id,
      name: "Demo Creator",
      nicheDescription: "Practical, evidence-based productivity for knowledge workers.",
      presentationStyle: "personality",
      differentiation: "Less hustle, more systems. Cite the research; show the math.",
      defaultModel: "claude-sonnet",
      accentColor: "#E5482F",
    },
  });

  await db.voiceProfile.upsert({
    where: { id: "demo-voice" },
    update: {},
    create: {
      id: "demo-voice",
      channelId: channel.id,
      label: "Default voice",
      isDefault: true,
      data: JSON.stringify({
        archetype: { ageVibe: "30s", profession: "engineer-writer", temperament: "calm-curious", authority: "peer-expert" },
        delivery: { cadence: "measured", energy: "warm-medium", pacing: "varied" },
        rhetoric: { hooks: ["counter-intuitive", "data-led"], transitions: ["bridge", "callback"], cta: "soft" },
        diction: { vocabulary: "everyday-precise", sentenceShape: "mixed", avoid: ["literally","very","quite"] },
        extras: { phraseKit: ["Here's the thing —", "But here's where it gets interesting:"], formatting: "spoken-style" },
      }),
    },
  });

  await db.audienceAvatar.upsert({
    where: { channelId: channel.id },
    update: {},
    create: {
      channelId: channel.id,
      demographics: JSON.stringify({ ageRange: "26–40", role: "knowledge worker", location: "global English-speaking" }),
      psychographics: JSON.stringify({ values: ["competence","autonomy"], pains: ["info-overload","time-poverty"] }),
      onlineBehavior: JSON.stringify({ platforms: ["YouTube","Twitter","Substack"], habits: ["multi-tab","deep-dive"] }),
      offlineBehavior: JSON.stringify({ environment: ["WFH","gym","commute"] }),
      keyQuestions: JSON.stringify(["What's actually worth doing today?","Which advice is BS?","How do experts decide?"]),
    },
  });

  const ideas = [
    { title: "I tried four productivity systems for 30 days. Only one worked.", strategy: "Comparison + receipts", outlierScore: 4.2 },
    { title: "Stop reading productivity books. Do this instead.", strategy: "Counter-intuitive hook", outlierScore: 6.1 },
    { title: "The 2-hour workday: how researchers actually plan their time", strategy: "Curiosity gap + authority", outlierScore: 3.4 },
  ];
  for (const i of ideas) {
    await db.idea.create({
      data: {
        channelId: channel.id,
        title: i.title,
        strategy: i.strategy,
        outlierScore: i.outlierScore,
        topic: "Productivity",
        suggestedLength: "8–12 min",
      },
    });
  }
}

async function seedIntel() {
  // Inlined to keep one Prisma client; mirrors prisma/seed-intel.ts.
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
  const TITLES = [
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
  const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

  for (const c of CHANNELS) {
    const ytId = "UC_" + c.handle.replace(/[^a-z0-9]+/gi, "_");
    const ch = await db.intelChannel.upsert({
      where: { youtubeId: ytId },
      update: {},
      create: {
        youtubeId: ytId,
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
    const videos = Array.from({ length: 8 }, (_, i) => {
      const seed = hash(c.handle + i);
      const topic = TOPICS[seed % TOPICS.length];
      const title = TITLES[seed % TITLES.length].replace("{topic}", topic);
      const baseViews = c.subs * (0.05 + (seed % 30) / 100);
      const m = ((seed % 100) / 12) - 1;
      const views = Math.max(500, Math.round(baseViews * Math.exp(m / 3)));
      const isShort = seed % 7 === 0;
      return {
        ytId: "yt_" + c.handle.replace(/[^a-z0-9]+/gi, "") + "_" + i,
        title, views, durationSeconds: isShort ? 45 : 600 + (seed % 1200),
        publishedAt: new Date(Date.now() - i * 5 * 24 * 60 * 60 * 1000),
        format: isShort ? "short" : "long",
      };
    });
    const avg = videos.reduce((a, v) => a + v.views, 0) / videos.length;
    for (const v of videos) {
      await db.intelVideo.upsert({
        where: { youtubeId: v.ytId },
        update: {},
        create: {
          intelChannelId: ch.id,
          youtubeId: v.ytId,
          title: v.title,
          publishedAt: v.publishedAt,
          durationSeconds: v.durationSeconds,
          views: BigInt(v.views),
          likes: Math.round(v.views * 0.03),
          comments: Math.round(v.views * 0.005),
          format: v.format,
          outlierScore: Math.round((v.views / Math.max(1, avg)) * 10) / 10,
          viewsPerSub: Math.round((v.views / Math.max(1, c.subs)) * 100) / 100,
        },
      });
    }
  }
}

async function main() {
  await seedTemplates();
  await seedDemoData();
  await seedIntel();
  const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "you@example.com").toLowerCase();
  // Don't print a configured admin password into deploy logs (this runs on every
  // Railway boot). Only echo the built-in dev default, which is public anyway.
  if (process.env.SEED_ADMIN_PASSWORD) {
    console.log("✓ Seed complete. Admin email:", adminEmail, "(password set via SEED_ADMIN_PASSWORD — not logged)");
  } else {
    console.log("✓ Seed complete. Admin email:", adminEmail, "  password: meyousocial-dev (default — set SEED_ADMIN_PASSWORD to change)");
  }
  if (process.env.RESET_ADMIN === "true") {
    console.log("⚠ RESET_ADMIN is still set — the admin password is rewritten on EVERY deploy.");
    console.log("  Remove RESET_ADMIN from Railway Variables now that you're back in.");
  }
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
