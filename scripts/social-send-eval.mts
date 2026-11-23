// What a social send records when Zernio hasn't finished — run before any
// deploy that touches src/lib/social/publish.ts or leg-outcome.ts, against a
// THROWAWAY schema (its name must end in "verify"):
//
//   DATABASE_URL="…?schema=<name>verify" npx tsx scripts/social-send-eval.mts
//   (npm run eval:social-send, with DATABASE_URL set the same way)
//
// On the local `npx prisma dev` Postgres add `&pgbouncer=true` to the URL: a
// second run otherwise stops at once on `prepared statement "s0" already exists`.
//
// The real send and the real reconcile pass run end to end against the
// database. Only Zernio is scripted: an in-process stand-in answers POST /posts
// and GET /posts/{id} with what each scenario sets, so nothing reaches a
// network. What is checked is the bug of 19 Nov 2026 (LSI Media) and its
// repair: a leg Zernio is still sending ("processing") is not a failure, keeps
// the Zernio post's id, is never sent a second time, and is settled from
// Zernio's own record; and the rows the old code wrote are put back so they
// settle too. It makes its own workspace and deletes it after; exit 1 on any
// failure.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

const schema = (() => { try { return new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") ?? ""; } catch { return ""; } })();
if (!schema.endsWith("verify")) {
  console.error(`Refusing to run: DATABASE_URL's schema is "${schema || "(none)"}" — it must be a throwaway whose name ends in "verify".`);
  process.exit(1);
}

// ── The stand-in for Zernio ─────────────────────────────────────────────────
type Leg = { platform: string; accountId: string; status: string; platformPostUrl?: string; errorMessage?: string; publishedAt?: string };
const remote = new Map<string, Leg[]>();   // what GET /posts/{id} answers
let nextCreate: { id: string; legs: Leg[] } | null = null;
let creates = 0;
const server = http.createServer((req, res) => {
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  req.on("data", () => { /* the body isn't read: every scenario sets its answer beforehand */ });
  req.on("end", () => {
    const path = (req.url ?? "").replace(/\?.*$/, "");
    if (req.method === "POST" && path === "/posts") {
      creates++;
      if (!nextCreate) return send(500, { error: "the scenario set no answer" });
      remote.set(nextCreate.id, nextCreate.legs);
      return send(201, { post: { _id: nextCreate.id, status: "publishing", platforms: nextCreate.legs } });
    }
    const m = /^\/posts\/([^/]+)$/.exec(path);
    if (req.method === "GET" && m) {
      const legs = remote.get(decodeURIComponent(m[1]));
      return legs ? send(200, { post: { _id: m[1], status: "publishing", platforms: legs } }) : send(404, { error: "no such post" });
    }
    send(404, { error: `unexpected ${req.method} ${path}` });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.ZERNIO_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.ZERNIO_API_KEY = `eval-${randomBytes(16).toString("hex")}`;
process.env.AUTOPILOT = "off";

const { db } = await import("@/lib/db");
const { publishSocialPost, reconcileStuckSocialPosts } = await import("@/lib/social/publish");
const { sendOutcome, rollUpPostStatus, legacyInFlightStatus, inFlightNote } = await import("@/lib/social/leg-outcome");
const { mayHavePosted } = await import("@/lib/social/unknown-outcome");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
};

// ── The rules, read directly ────────────────────────────────────────────────
check("published and publishing are out", sendOutcome({ status: "published", error: null }) === "posted" && sendOutcome({ status: "publishing", error: null }) === "posted");
check("processing, pending, uploading and an unknown word are in flight",
  ["processing", "pending", "uploading", "unknown", "something-new"].every((s) => sendOutcome({ status: s, error: null }) === "in_flight"));
check("failed, error, cancelled, rejected, or any error message, is a failure",
  ["failed", "error", "cancelled", "rejected"].every((s) => sendOutcome({ status: s, error: null }) === "failed")
  && sendOutcome({ status: "processing", error: "Media rejected" }) === "failed");
check("a pending leg keeps the post publishing, even beside posted and failed legs",
  rollUpPostStatus([{ status: "posted" }, { status: "pending" }]) === "publishing"
  && rollUpPostStatus([{ status: "posted" }, { status: "failed" }, { status: "pending" }]) === "publishing"
  && rollUpPostStatus([{ status: "posted" }, { status: "posted" }]) === "posted"
  && rollUpPostStatus([{ status: "posted" }, { status: "failed" }]) === "partial"
  && rollUpPostStatus([{ status: "failed" }]) === "failed");
check("the old reason is recognised only when it named an in-flight status",
  legacyInFlightStatus("Zernio reported status “processing”") === "processing"
  && legacyInFlightStatus("Zernio reported status “failed”") === null
  && legacyInFlightStatus("Zernio reported status “processing” and more") === null
  && legacyInFlightStatus(null) === null);

// ── The fixture workspace ───────────────────────────────────────────────────
const tag = randomBytes(4).toString("hex");
const ws = await db.workspace.create({ data: { name: `Social send eval ${tag}` } });
const mkPost = async (status: string, legs: { provider: string; accountId: string; status?: string; providerPostId?: string | null; error?: string | null }[]) => {
  const post = await db.socialPost.create({ data: { workspaceId: ws.id, text: `Eval post ${randomBytes(3).toString("hex")} — nothing here is sent.`, status } });
  for (const l of legs) {
    await db.socialPostTarget.create({
      data: { postId: post.id, provider: l.provider, accountId: l.accountId, status: l.status ?? "pending", providerPostId: l.providerPostId ?? null, error: l.error ?? null },
    });
  }
  return post.id;
};
const read = async (id: string) => {
  const p = await db.socialPost.findUniqueOrThrow({ where: { id }, include: { targets: { orderBy: { provider: "asc" } } } });
  const leg = (provider: string) => p.targets.find((t) => t.provider === provider)!;
  return { status: p.status, leg };
};
/** Make a post look quiet for longer than the reconcile pass waits. */
const age = (id: string, minutes: number) =>
  db.$executeRaw`UPDATE "SocialPost" SET "updatedAt" = NOW() - (${minutes} * INTERVAL '1 minute') WHERE id = ${id}`;

try {
  // ── 1. The send: one leg out, one still processing ────────────────────────
  const a = await mkPost("draft", [{ provider: "FACEBOOK", accountId: "fb-a" }, { provider: "LINKEDIN", accountId: "li-a" }]);
  nextCreate = {
    id: "zp-a",
    legs: [
      { platform: "facebook", accountId: "fb-a", status: "published", platformPostUrl: "https://example.test/fb/a" },
      { platform: "linkedin", accountId: "li-a", status: "processing" },
    ],
  };
  await publishSocialPost(a);
  let s = await read(a);
  check("the leg Zernio published is posted", s.leg("FACEBOOK").status === "posted" && s.leg("FACEBOOK").providerPostId === "zp-a", s.leg("FACEBOOK"));
  check("the leg Zernio is still processing is pending, not failed", s.leg("LINKEDIN").status === "pending", s.leg("LINKEDIN"));
  check("…it keeps the Zernio post's id", s.leg("LINKEDIN").providerPostId === "zp-a", s.leg("LINKEDIN").providerPostId);
  check("…and its note says so, without the may-have-posted warning",
    s.leg("LINKEDIN").error === inFlightNote("processing") && !mayHavePosted(s.leg("LINKEDIN").error), s.leg("LINKEDIN").error);
  check("the post is still publishing, not partly failed", s.status === "publishing", s.status);

  // ── 2. Nothing sends it a second time ─────────────────────────────────────
  const before = creates;
  await publishSocialPost(a);
  check("Retry on a post that is still publishing sends nothing", creates === before, { creates, before });
  // Even if a row were claimable (an old "partial" one), the in-flight leg is left out.
  await db.socialPost.update({ where: { id: a }, data: { status: "partial" } });
  await publishSocialPost(a);
  s = await read(a);
  check("…and a claimable post still doesn't re-send its in-flight leg", creates === before && s.leg("LINKEDIN").status === "pending", { creates, before, leg: s.leg("LINKEDIN").status });
  await db.socialPost.update({ where: { id: a }, data: { status: "publishing" } });

  // ── 3. The reconcile pass settles it from Zernio's record ─────────────────
  await age(a, 16);
  await reconcileStuckSocialPosts();
  s = await read(a);
  check("while Zernio still says processing, the leg waits", s.leg("LINKEDIN").status === "pending" && s.status === "publishing", { leg: s.leg("LINKEDIN").status, post: s.status });
  const wentOut = new Date(Date.now() - 3 * 60_000);
  remote.set("zp-a", [
    { platform: "facebook", accountId: "fb-a", status: "published", platformPostUrl: "https://example.test/fb/a" },
    { platform: "linkedin", accountId: "li-a", status: "published", platformPostUrl: "https://example.test/li/a", publishedAt: wentOut.toISOString() },
  ]);
  await age(a, 16);
  await reconcileStuckSocialPosts();
  s = await read(a);
  check("once Zernio says published, the leg is posted with its link", s.leg("LINKEDIN").status === "posted" && s.leg("LINKEDIN").platformPostUrl === "https://example.test/li/a" && s.leg("LINKEDIN").error === null, s.leg("LINKEDIN"));
  check("…at the time Zernio says it went out", s.leg("LINKEDIN").postedAt?.getTime() === wentOut.getTime(), { postedAt: s.leg("LINKEDIN").postedAt, wentOut });
  check("…and the post is posted", s.status === "posted", s.status);

  // ── 4. The repair: a row the old code wrote ───────────────────────────────
  const b = await mkPost("partial", [
    { provider: "FACEBOOK", accountId: "fb-b", status: "posted", providerPostId: "zp-b" },
    { provider: "INSTAGRAM", accountId: "ig-b", status: "failed", error: "Zernio reported status “processing”" },
  ]);
  remote.set("zp-b", [
    { platform: "facebook", accountId: "fb-b", status: "published" },
    { platform: "instagram", accountId: "ig-b", status: "failed", errorMessage: "Instagram refused the picture" },
  ]);
  await reconcileStuckSocialPosts();
  s = await read(b);
  check("an old wrongly-failed leg takes its sibling's Zernio id and waits", s.leg("INSTAGRAM").status === "pending" && s.leg("INSTAGRAM").providerPostId === "zp-b", s.leg("INSTAGRAM"));
  check("…and its post goes back to publishing, where Retry can't claim it", s.status === "publishing", s.status);
  const sends = creates;
  await publishSocialPost(b);
  check("…so nothing is sent for it", creates === sends, { creates, sends });
  await age(b, 16);
  await reconcileStuckSocialPosts();
  s = await read(b);
  check("then it takes the outcome Zernio recorded — here a real failure, with Zernio's reason",
    s.leg("INSTAGRAM").status === "failed" && s.leg("INSTAGRAM").error === "Instagram refused the picture" && s.status === "partial", { leg: s.leg("INSTAGRAM"), post: s.status });

  // The same row, where Zernio's record says it went out after all.
  const c = await mkPost("partial", [
    { provider: "FACEBOOK", accountId: "fb-c", status: "posted", providerPostId: "zp-c" },
    { provider: "INSTAGRAM", accountId: "ig-c", status: "failed", error: "Zernio reported status “processing”" },
  ]);
  remote.set("zp-c", [
    { platform: "facebook", accountId: "fb-c", status: "published" },
    { platform: "instagram", accountId: "ig-c", status: "published", platformPostUrl: "https://example.test/ig/c" },
  ]);
  await reconcileStuckSocialPosts();
  await age(c, 16);
  await reconcileStuckSocialPosts();
  s = await read(c);
  check("…and where Zernio's record says it posted, the leg and the post are posted", s.leg("INSTAGRAM").status === "posted" && s.leg("INSTAGRAM").platformPostUrl === "https://example.test/ig/c" && s.status === "posted", { leg: s.leg("INSTAGRAM"), post: s.status });

  // ── 5. The repair leaves alone what it can't or shouldn't read back ───────
  const d = await mkPost("partial", [
    { provider: "FACEBOOK", accountId: "fb-d", status: "posted", providerPostId: "zp-d" },
    { provider: "INSTAGRAM", accountId: "ig-d", status: "failed", error: "Zernio reported status “failed”" },
  ]);
  const e = await mkPost("failed", [{ provider: "INSTAGRAM", accountId: "ig-e", status: "failed", error: "Zernio reported status “processing”" }]);
  await reconcileStuckSocialPosts();
  s = await read(d);
  check("a leg Zernio really failed stays failed, untouched", s.leg("INSTAGRAM").status === "failed" && s.leg("INSTAGRAM").error === "Zernio reported status “failed”" && s.status === "partial", { leg: s.leg("INSTAGRAM"), post: s.status });
  s = await read(e);
  check("with no sibling to take an id from, the leg stays failed and warns it may have posted",
    s.leg("INSTAGRAM").status === "failed" && s.leg("INSTAGRAM").providerPostId === null && mayHavePosted(s.leg("INSTAGRAM").error) && s.status === "failed", { leg: s.leg("INSTAGRAM"), post: s.status });

  // ── 6. A leg that never settles is given up on, honestly ──────────────────
  const f = await mkPost("draft", [{ provider: "FACEBOOK", accountId: "fb-f" }, { provider: "LINKEDIN", accountId: "li-f" }]);
  nextCreate = {
    id: "zp-f",
    legs: [
      { platform: "facebook", accountId: "fb-f", status: "published" },
      { platform: "linkedin", accountId: "li-f", status: "processing" },
    ],
  };
  await publishSocialPost(f);
  await age(f, 25 * 60);
  await reconcileStuckSocialPosts();
  s = await read(f);
  check("after a day in flight the leg is failed as unknown, warns it may have posted, and keeps its id",
    s.leg("LINKEDIN").status === "failed" && mayHavePosted(s.leg("LINKEDIN").error) && s.leg("LINKEDIN").providerPostId === "zp-f" && s.status === "partial", { leg: s.leg("LINKEDIN"), post: s.status });
} finally {
  await db.workspace.delete({ where: { id: ws.id } }).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : e));
  server.close();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
