// Migrate LSI Media's data from the frozen Spark database into MeYouSocial.
// READ-ONLY against the old DB (raw SELECTs); typed writes into the new DB.
//
// Usage:
//   OLD_DATABASE_URL=postgres://... NEW_DATABASE_URL=postgres://... node scripts/migrate-spark-data.mjs
//
// Idempotency: aborts if the target workspace already has blog posts (pass
// FORCE=1 to append anyway). Never modifies the old database.

import { PrismaClient } from "@prisma/client";

const OLD_URL = process.env.OLD_DATABASE_URL;
const NEW_URL = process.env.NEW_DATABASE_URL;
if (!OLD_URL || !NEW_URL) {
  console.error("Set OLD_DATABASE_URL and NEW_DATABASE_URL");
  process.exit(1);
}

const oldDb = new PrismaClient({ datasourceUrl: OLD_URL }); // raw reads only
const newDb = new PrismaClient({ datasourceUrl: NEW_URL });

const STATE_MAP = {
  drafting: "drafting",
  draft_review: "draft_review",
  seo_a11y_review: "draft_review",
  assets_pending: "draft_review",
  final_approval: "final_approval",
  scheduled: "published",
  published: "published",
  distributed: "published",
  analyzing: "published",
};

async function main() {
  // --- source workspace (Spark: workspaces.slug = 'lsi-media') ---------------
  const [ws] = await oldDb.$queryRawUnsafe(
    `SELECT id, name, slug FROM workspaces WHERE slug = 'lsi-media' LIMIT 1`,
  );
  if (!ws) throw new Error("Spark workspace 'lsi-media' not found in old DB");
  console.log(`source workspace: ${ws.name} (${ws.id})`);

  // --- target workspace + admin membership -----------------------------------
  const adminEmail = process.env.ADMIN_EMAIL ?? "idris.grant@gmail.com";
  const admin = await newDb.user.findUnique({ where: { email: adminEmail } });
  if (!admin) throw new Error(`Admin user ${adminEmail} not found in new DB — sign in once first`);

  let target = await newDb.workspace.findFirst({ where: { name: ws.name } });
  if (!target) {
    target = await newDb.workspace.create({ data: { name: ws.name } });
    console.log(`created target workspace "${target.name}" (${target.id})`);
  }
  const membership = await newDb.membership.findFirst({
    where: { userId: admin.id, workspaceId: target.id },
  });
  if (!membership) {
    await newDb.membership.create({
      data: { userId: admin.id, workspaceId: target.id, role: "ADMIN", status: "active" },
    });
    console.log(`granted ${adminEmail} ADMIN on "${target.name}"`);
  }

  const existing = await newDb.blogPost.count({ where: { workspaceId: target.id } });
  if (existing > 0 && process.env.FORCE !== "1") {
    throw new Error(`target workspace already has ${existing} blog posts — set FORCE=1 to append`);
  }

  // --- org profile ------------------------------------------------------------
  const [org] = await oldDb.$queryRawUnsafe(
    `SELECT description, industry, audience_notes FROM org_profiles WHERE workspace_id = $1 LIMIT 1`,
    ws.id,
  ).catch(async () => {
    // audience column name differs across Spark revisions — fall back.
    return oldDb.$queryRawUnsafe(
      `SELECT description, industry, NULL AS audience_notes FROM org_profiles WHERE workspace_id = $1 LIMIT 1`,
      ws.id,
    );
  });
  if (org) {
    await newDb.orgProfile.upsert({
      where: { workspaceId: target.id },
      update: { description: org.description, industry: org.industry, audience: org.audience_notes ?? null },
      create: {
        workspaceId: target.id,
        description: org.description,
        industry: org.industry,
        audience: org.audience_notes ?? null,
      },
    });
    console.log("org profile migrated");
  } else {
    console.log("no org profile in old DB");
  }

  // --- articles (+ seo_outputs) → BlogPost ------------------------------------
  const articles = await oldDb.$queryRawUnsafe(
    `SELECT a.id, a.title, a.state, a.body, a.audience, a.published_url, a.protected_from_rewrite,
            a.created_at, a.updated_at,
            s.slug AS seo_slug, s.seo_title, s.meta_description, s.focus_keyword
     FROM articles a
     LEFT JOIN seo_outputs s ON s.article_id = a.id
     WHERE a.workspace_id = $1
     ORDER BY a.created_at ASC`,
    ws.id,
  ).catch(async () => {
    console.log("seo_outputs join failed (column drift) — migrating articles without SEO fields");
    return oldDb.$queryRawUnsafe(
      `SELECT id, title, state, body, audience, published_url, protected_from_rewrite,
              created_at, updated_at,
              NULL AS seo_slug, NULL AS seo_title, NULL AS meta_description, NULL AS focus_keyword
       FROM articles WHERE workspace_id = $1 ORDER BY created_at ASC`,
      ws.id,
    );
  });

  const postIdMap = new Map(); // old article id -> new post id
  for (const a of articles) {
    const post = await newDb.blogPost.create({
      data: {
        workspaceId: target.id,
        title: a.title,
        status: STATE_MAP[a.state] ?? "drafting",
        body: a.body,
        audience: a.audience,
        slug: a.seo_slug,
        metaTitle: a.seo_title ? String(a.seo_title).slice(0, 60) : null,
        metaDescription: a.meta_description ? String(a.meta_description).slice(0, 155) : null,
        focusKeyword: a.focus_keyword,
        publishedUrl: a.published_url,
        publishedAt: STATE_MAP[a.state] === "published" ? a.updated_at : null,
        protectedFromRewrite: !!a.protected_from_rewrite,
        createdById: admin.id,
        createdAt: a.created_at,
      },
    });
    postIdMap.set(a.id, post.id);
  }
  console.log(`articles migrated: ${postIdMap.size}`);

  // --- citations → BlogCitation ----------------------------------------------
  let citations = [];
  try {
    citations = await oldDb.$queryRawUnsafe(
      `SELECT article_id, claim, source_url, verified FROM citations
       WHERE article_id = ANY($1::uuid[])`,
      [...postIdMap.keys()],
    );
  } catch {
    console.log("citations table not readable — skipping");
  }
  let citCount = 0;
  for (const c of citations) {
    const postId = postIdMap.get(c.article_id);
    if (!postId || !c.claim) continue;
    await newDb.blogCitation.create({
      data: { postId, claim: String(c.claim).slice(0, 1000), sourceUrl: c.source_url, verified: !!c.verified },
    });
    citCount++;
  }
  console.log(`citations migrated: ${citCount}`);

  // --- ideas → BlogIdea --------------------------------------------------------
  let ideas = [];
  try {
    ideas = await oldDb.$queryRawUnsafe(
      `SELECT title, status, source, created_at FROM ideas WHERE workspace_id = $1`,
      ws.id,
    );
  } catch {
    console.log("ideas table not readable — skipping");
  }
  const IDEA_STATUS = { discovered: "discovered", approved: "approved", rejected: "rejected", refresh: "approved" };
  let ideaCount = 0;
  for (const i of ideas) {
    await newDb.blogIdea.create({
      data: {
        workspaceId: target.id,
        title: i.title,
        status: IDEA_STATUS[i.status] ?? "discovered",
        source: i.source && String(i.source).includes("ai") ? "ai" : "manual",
        createdAt: i.created_at,
      },
    });
    ideaCount++;
  }
  console.log(`ideas migrated: ${ideaCount}`);

  // --- analytics_snapshots → BlogSnapshot -------------------------------------
  let snaps = [];
  try {
    snaps = await oldDb.$queryRawUnsafe(
      `SELECT article_id, captured_at, impressions, clicks, position, sessions, conversions
       FROM analytics_snapshots WHERE workspace_id = $1`,
      ws.id,
    );
  } catch {
    console.log("analytics_snapshots not readable — skipping");
  }
  let snapCount = 0;
  for (const s of snaps) {
    const postId = postIdMap.get(s.article_id);
    if (!postId) continue;
    await newDb.blogSnapshot.create({
      data: {
        postId,
        capturedAt: s.captured_at,
        impressions: s.impressions,
        clicks: s.clicks,
        position: s.position,
        sessions: s.sessions,
        conversions: s.conversions,
      },
    });
    snapCount++;
  }
  console.log(`snapshots migrated: ${snapCount}`);

  console.log("DONE. Old database untouched.");
}

main()
  .catch((e) => {
    console.error("MIGRATION FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  });
