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
// What GET /posts (the list) answers, per profile. `createdAt` is what the date filter reads.
type Listed = { _id: string; content: string | null; createdAt: string; platforms: Array<Omit<Leg, "accountId"> & { accountId?: string }> };
const listed = new Map<string, Listed[]>();
const LIST_PARAMS = new Set(["profileId", "fromDate", "toDate", "view", "limit", "offset"]);
const list = {
  mode: "ok" as "ok" | "no-posts-key" | "dates-return-nothing",
  refuseView: false,          // an API that doesn't know `view` answers 400, as Zernio does for any unknown parameter
  strangeParams: [] as string[],
  calls: 0,
};
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
    if (req.method === "GET" && path === "/posts") {
      list.calls++;
      const q = new URL(req.url ?? "", "http://x").searchParams;
      for (const k of q.keys()) if (!LIST_PARAMS.has(k)) list.strangeParams.push(k);
      if ([...q.keys()].some((k) => !LIST_PARAMS.has(k))) return send(400, { error: "unknown parameter" });
      if (list.refuseView && q.has("view")) return send(400, { error: "unknown parameter view" });
      if (list.mode === "no-posts-key") return send(200, { data: [] });
      const from = q.get("fromDate"), to = q.get("toDate");
      let rows = listed.get(q.get("profileId") ?? "") ?? [];
      if (from || to) {
        rows = list.mode === "dates-return-nothing" ? [] : rows.filter((r) => (!from || r.createdAt.slice(0, 10) >= from) && (!to || r.createdAt.slice(0, 10) <= to));
      }
      const offset = Number(q.get("offset") ?? 0), limit = Number(q.get("limit") ?? 10);
      return send(200, { posts: rows.slice(offset, offset + limit), pagination: { page: 1 } });
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
const { lookUpUnanswered, settleUnansweredSends, NO_RECORD, NO_ENTRY } = await import("@/lib/social/unanswered");

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
const extraWs: string[] = [];   // one more workspace per lookup case (section 7)
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

  // ── 7. A send that never got an answer is looked up in Zernio's list ──────
  // (CommunityForce, 23 Oct 2026: three legs timed out, no Zernio id, and a
  // month later nobody could say whether it had gone out.) One workspace per
  // case: the lookup proves Zernio's list against a post the workspace is known
  // to have sent, so one case's posts must not serve as another's proof.
  const TIMED_OUT = "The operation was aborted due to timeout";
  const DAY_MS = 86_400_000;
  const sentAt = new Date(Date.now() - 3 * DAY_MS);      // when the unanswered send was due
  const controlAt = new Date(Date.now() - 5 * DAY_MS);   // when a post known to have gone out went
  const NETS = [["FACEBOOK", "fb"], ["LINKEDIN", "li"], ["TWITTER", "tw"]] as const;
  /** A workspace with one post known sent (in Zernio's list unless told not to be) and one that timed out. */
  const mkCase = async (tag: string, opts: { controlListed?: boolean; controlAccountIds?: boolean } = {}) => {
    const w = await db.workspace.create({ data: { name: `Social send eval ${tag}`, zernioProfileId: `prof-${tag}` } });
    extraWs.push(w.id);
    const controlText = `Known post ${tag} — it went out.`;
    const control = await db.socialPost.create({ data: { workspaceId: w.id, text: controlText, status: "posted", scheduledAt: controlAt, publishedAt: controlAt } });
    await db.socialPostTarget.create({ data: { postId: control.id, provider: "FACEBOOK", accountId: `fb-${tag}`, status: "posted", providerPostId: `zp-ctl-${tag}`, postedAt: controlAt } });
    const text = `Unanswered post ${tag}:  two  spaces and\na line break.`;
    const post = await db.socialPost.create({ data: { workspaceId: w.id, text, status: "failed", scheduledAt: sentAt } });
    for (const [provider, short] of NETS) {
      await db.socialPostTarget.create({ data: { postId: post.id, provider, accountId: `${short}-${tag}`, status: "failed", error: TIMED_OUT } });
    }
    const rows: Listed[] = opts.controlListed === false ? [] : [{
      _id: `zp-ctl-${tag}`, content: controlText, createdAt: controlAt.toISOString(),
      platforms: [{ platform: "facebook", status: "published", ...(opts.controlAccountIds === false ? {} : { accountId: `fb-${tag}` }) }],
    }];
    listed.set(`prof-${tag}`, rows);
    const legs = async () => {
      const p = await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
      return { status: p.status, of: (provider: string) => p.targets.find((t) => t.provider === provider)!, all: p.targets };
    };
    /** Zernio's row for the send itself, with the outcome each network had. */
    const itWentOut = (id: string, outcome: Partial<Record<"fb" | "li" | "tw", Omit<Leg, "platform" | "accountId">>>, content: string | null = "Unanswered post " + tag + ": two spaces and a line break.") =>
      rows.push({
        _id: id, content, createdAt: sentAt.toISOString(),
        platforms: (Object.entries(outcome) as ["fb" | "li" | "tw", Omit<Leg, "platform" | "accountId">][]).map(([short, o]) => ({
          platform: short === "fb" ? "facebook" : short === "li" ? "linkedin" : "twitter", accountId: `${short}-${tag}`, ...o,
        })),
      });
    return { w, postId: post.id, rows, legs, itWentOut };
  };

  // 7a. It went out: Zernio's list holds it, and each leg takes what Zernio recorded.
  const u1 = await mkCase("u1");
  const outAt = new Date(sentAt.getTime() + 20_000).toISOString();
  u1.itWentOut("zp-u1", {
    fb: { status: "published", platformPostUrl: "https://example.test/fb/u1", publishedAt: outAt },
    li: { status: "published", platformPostUrl: "https://example.test/li/u1", publishedAt: outAt },
    tw: { status: "published", platformPostUrl: "https://example.test/tw/u1", publishedAt: outAt },
  });
  const sendsBefore = creates;
  let o = await lookUpUnanswered(u1.postId);
  let l = await u1.legs();
  check("a timed-out send Zernio published is found in its list", o.verdict === "settled" && o.posted === 3, o);
  check("…every leg is posted, with Zernio's post id, link and time",
    l.all.every((t) => t.status === "posted" && t.providerPostId === "zp-u1" && !!t.platformPostUrl && t.error === null && t.postedAt?.toISOString() === outAt), l.all);
  check("…the post is posted, and nothing was sent to find that out", l.status === "posted" && creates === sendsBefore, { status: l.status, creates, sendsBefore });
  check("…and only documented parameters were sent to Zernio's list", list.strangeParams.length === 0, list.strangeParams);

  // 7b. It didn't: the list provably covers those days and the post isn't in it.
  const u2 = await mkCase("u2");
  o = await lookUpUnanswered(u2.postId);
  l = await u2.legs();
  check("a send Zernio never received is said to be absent, once the list is proven", o.verdict === "no_record", o);
  check("…its legs stay failed, say Retry is safe, and no longer warn they may have posted",
    l.all.every((t) => t.status === "failed" && t.error === NO_RECORD && !mayHavePosted(t.error) && t.providerPostId === null) && l.status === "failed", l.all);
  o = await lookUpUnanswered(u2.postId);
  check("…and a settled post isn't looked up again", o.verdict === "nothing", o);

  // 7c. ⚠ Absence needs proof: an empty list proves nothing.
  const u3 = await mkCase("u3", { controlListed: false });
  o = await lookUpUnanswered(u3.postId);
  l = await u3.legs();
  check("an empty list without the known post is NOT taken as 'it didn't go out'", o.verdict === "unproven", o);
  check("…and the legs keep their warning", l.all.every((t) => t.status === "failed" && t.error === TIMED_OUT && mayHavePosted(t.error)), l.all);

  // 7d. A list that can't tie posts to accounts proves nothing either.
  const u4 = await mkCase("u4", { controlAccountIds: false });
  o = await lookUpUnanswered(u4.postId);
  l = await u4.legs();
  check("a list with no account on its rows is not trusted for absence", o.verdict === "unproven" && l.all.every((t) => t.error === TIMED_OUT), { o, errors: l.all.map((t) => t.error) });

  // 7e. A reply in an unknown shape is an error, never an empty list.
  const u5 = await mkCase("u5");
  list.mode = "no-posts-key";
  o = await lookUpUnanswered(u5.postId);
  list.mode = "ok";
  l = await u5.legs();
  check("a list reply without `posts` is an error, and nothing changes", o.verdict === "error" && l.all.every((t) => t.error === TIMED_OUT), { o, errors: l.all.map((t) => t.error) });

  // 7f. Each network keeps its own outcome.
  const u6 = await mkCase("u6");
  u6.itWentOut("zp-u6", {
    fb: { status: "published", platformPostUrl: "https://example.test/fb/u6" },
    li: { status: "failed", errorMessage: "LinkedIn token expired" },
    tw: { status: "processing" },
  });
  o = await lookUpUnanswered(u6.postId);
  l = await u6.legs();
  check("a mixed record settles each leg its own way", o.verdict === "settled" && o.posted === 1 && o.failed === 1 && o.pending === 1, o);
  check("…posted where Zernio published", l.of("FACEBOOK").status === "posted" && l.of("FACEBOOK").providerPostId === "zp-u6", l.of("FACEBOOK"));
  check("…failed with Zernio's own reason where it failed, no longer 'may have posted'",
    l.of("LINKEDIN").status === "failed" && l.of("LINKEDIN").error === "LinkedIn token expired" && l.of("LINKEDIN").providerPostId === "zp-u6", l.of("LINKEDIN"));
  check("…still sending where Zernio is, with the id, and the post waits as publishing",
    l.of("TWITTER").status === "pending" && l.of("TWITTER").providerPostId === "zp-u6" && l.status === "publishing", { leg: l.of("TWITTER"), post: l.status });

  // 7g. A post this app already knows is not mistaken for the send, and an account Zernio left out is said so.
  const u7 = await mkCase("u7");
  const twin = await db.socialPost.create({ data: { workspaceId: u7.w.id, text: "Unanswered post u7:  two  spaces and\na line break.", status: "posted", scheduledAt: sentAt } });
  await db.socialPostTarget.create({ data: { postId: twin.id, provider: "FACEBOOK", accountId: "fb-u7", status: "posted", providerPostId: "zp-twin-u7", postedAt: sentAt } });
  u7.itWentOut("zp-twin-u7", { fb: { status: "published" } });
  o = await lookUpUnanswered(u7.postId);
  check("a row with the same words that belongs to another post here is not this send", o.verdict === "no_record", o);
  const u8 = await mkCase("u8");
  u8.itWentOut("zp-u8", { fb: { status: "published" }, li: { status: "published" } });
  o = await lookUpUnanswered(u8.postId);
  l = await u8.legs();
  check("an account missing from Zernio's record did not go out there", l.of("TWITTER").status === "failed" && l.of("TWITTER").error === NO_ENTRY && l.status === "partial", { leg: l.of("TWITTER"), post: l.status });

  // 7h. Other words to the same accounts are another post; words Zernio no longer holds can't be told apart.
  const u9 = await mkCase("u9");
  u9.itWentOut("zp-other-u9", { fb: { status: "published" } }, "Something else entirely, posted from Zernio's dashboard.");
  o = await lookUpUnanswered(u9.postId);
  check("a different post to the same account doesn't hide the answer", o.verdict === "no_record", o);
  const u10 = await mkCase("u10");
  u10.rows.push({ _id: "zp-wordless-u10", content: null, createdAt: new Date(sentAt.getTime() + 6 * 3_600_000).toISOString(), platforms: [{ platform: "facebook", accountId: "fb-u10", status: "published" }] });
  o = await lookUpUnanswered(u10.postId);
  check("a wordless row hours away could be this send, so absence isn't claimed", o.verdict === "unproven", o);
  const u11 = await mkCase("u11");
  u11.itWentOut("zp-u11", { fb: { status: "published" }, li: { status: "published" }, tw: { status: "published" } }, null);
  o = await lookUpUnanswered(u11.postId);
  check("a single wordless row made at the moment of the send is this send", o.verdict === "settled" && o.posted === 3, o);

  // 7i. The list is asked the way the live API allows.
  const u12 = await mkCase("u12");
  u12.itWentOut("zp-u12", { fb: { status: "published" }, li: { status: "published" }, tw: { status: "published" } });
  list.refuseView = true;
  o = await lookUpUnanswered(u12.postId);
  list.refuseView = false;
  check("an API that refuses `view` is asked again without it", o.verdict === "settled" && o.posted === 3, o);
  const u13 = await mkCase("u13");
  u13.itWentOut("zp-u13", { fb: { status: "published" }, li: { status: "published" }, tw: { status: "published" } });
  list.mode = "dates-return-nothing";
  o = await lookUpUnanswered(u13.postId);
  list.mode = "ok";
  check("a date filter that hides everything falls back to walking the list", o.verdict === "settled" && o.posted === 3, o);

  // 7j. The sweep finds them by itself, and waits between looks.
  const u14 = await mkCase("u14");
  u14.itWentOut("zp-u14", { fb: { status: "published" }, li: { status: "published" }, tw: { status: "published" } });
  const swept = await settleUnansweredSends({ force: true });
  l = await u14.legs();
  check("the sweep settles an unanswered send without being asked", swept.some((x) => x.postId === u14.postId && x.verdict === "settled") && l.status === "posted", swept);
  const u15 = await mkCase("u15");
  u15.itWentOut("zp-u15", { fb: { status: "published" }, li: { status: "published" }, tw: { status: "published" } });
  const callsBefore = list.calls;
  const again = await settleUnansweredSends();
  check("…and does not look again minutes later", again.length === 0 && list.calls === callsBefore, { again, calls: list.calls, callsBefore });
} finally {
  for (const id of extraWs) await db.workspace.delete({ where: { id } }).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : e));
  await db.workspace.delete({ where: { id: ws.id } }).catch((e) => console.error("cleanup failed:", e instanceof Error ? e.message : e));
  server.close();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
