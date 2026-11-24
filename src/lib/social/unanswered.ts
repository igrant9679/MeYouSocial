/**
 * A send that never got an answer, looked up in Zernio's own list of posts.
 *
 * When the request to Zernio times out, or the process dies before the answer,
 * the legs are failed with "this may have posted anyway" and carry no Zernio
 * post id — so nothing can read their outcome back, and the only button is
 * Retry, which may post a second time. CommunityForce's 23 Oct 2026 post sat
 * like that for a month, and its three networks hide older posts from anyone
 * not signed in, so a person couldn't settle it either.
 *
 * Zernio knows. Its list of posts for the profile, over the days around the
 * send, either holds a post with the same words to the same accounts that this
 * app has no record of — that is the send, and each leg takes the outcome
 * Zernio recorded — or it doesn't, and then the send never reached Zernio and
 * Retry is safe.
 *
 * ⚠ ABSENCE NEEDS PROOF. "Zernio has no such post" is only said when the same
 * list visibly contains a post this app KNOWS it sent in those days (the
 * control). A list that came back empty because a parameter was wrong, a
 * filter means something else, or the key is for another profile would
 * otherwise read as "it didn't go out" and invite the very double post this
 * exists to prevent. With no control the answer is "couldn't tell", and the
 * warning stays. Finding the post needs no such proof: presence is evidence.
 *
 * Nothing here sends.
 */
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { ZERNIO_FAILED, ZERNIO_POSTED, inFlightNote, rollUpPostStatus } from "@/lib/social/leg-outcome";
import { mayHavePosted } from "@/lib/social/unknown-outcome";
import { listZernioPosts, zernioConfigured, type ZernioListedPost } from "@/lib/zernio";

const DAY = 86_400_000;
/** A send older than this is left to a person: the window to list grows too wide to trust. */
const MAX_AGE_DAYS = 90;
/** How far either side of the send a control post may be. */
const CONTROL_REACH_DAYS = 10;
/** Longest stretch between the first attempt and the last one that is still looked up. */
const MAX_SPAN_DAYS = 45;

/** ⚠ Neither sentence may read as "may have posted" (`mayHavePosted`): a settled leg must leave the lookup's own list. */
export const NO_RECORD = "Zernio has no post matching this one, so it did not go out. Retry is safe.";
export const NO_ENTRY = "Zernio's record of this post has no entry for this account, so it did not go out here. Retry is safe.";

export type UnansweredVerdict =
  | "settled"    // Zernio holds the post: each leg took its recorded outcome
  | "no_record"  // Zernio's list is proven readable and the post isn't in it
  | "unproven"   // the post isn't in the list, but nothing proves the list is complete
  | "error"      // Zernio couldn't be asked
  | "nothing";   // no leg of this post is waiting on an answer

export type UnansweredOutcome = {
  postId: string;
  verdict: UnansweredVerdict;
  posted: number;
  failed: number;
  pending: number;
  detail?: string;
};

type Leg = { id: string; accountId: string; provider: string; status: string; providerPostId: string | null; error: string | null };

/** A leg whose send was never answered: failed, no Zernio id, and a reason that says it may be out. */
export function isUnanswered(leg: { status: string; providerPostId: string | null; error: string | null }): boolean {
  return leg.status === "failed" && !leg.providerPostId && mayHavePosted(leg.error);
}

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Zernio's list, read for one send. `candidates` are the rows this app has no
 * record of that went to at least one of the waiting accounts; `matches` are
 * the candidates that are this send — the same words, or, where Zernio no
 * longer holds a row's words, the single one made within a quarter of an hour
 * of an attempt. `strangers` is true when some candidate could be this send
 * and can't be told: a wordless row that didn't match.
 */
export function matchListedPosts(
  text: string,
  accountIds: string[],
  rows: ZernioListedPost[],
  knownIds: ReadonlySet<string>,
  attempts: Date[],
): { matches: ZernioListedPost[]; candidates: ZernioListedPost[]; strangers: boolean } {
  const want = norm(text);
  const accounts = new Set(accountIds);
  const candidates = rows.filter((r) => r.postId && !knownIds.has(r.postId) && r.perPlatform.some((p) => p.accountId && accounts.has(p.accountId)));
  const byWords = candidates.filter((r) => r.content !== null && norm(r.content) === want);
  if (byWords.length) return { matches: byWords, candidates, strangers: false };
  const wordless = candidates.filter((r) => r.content === null);
  const near = (d: Date | null) => !!d && attempts.some((a) => Math.abs(a.getTime() - d.getTime()) <= 15 * 60_000);
  const byTime = wordless.filter((r) => near(r.createdAt) || near(r.scheduledFor));
  if (byTime.length === 1) return { matches: byTime, candidates, strangers: false };
  return { matches: [], candidates, strangers: wordless.length > 0 };
}

/**
 * Does Zernio's list read the way this app needs it to? The control is a post
 * this app knows went out: its row must be there, name the account this app
 * sent it from, and carry the words this app sent. Each is a separate proof —
 * the row, that the list covers those days; the account, that rows can be tied
 * to accounts; the words, that a row with other words is another post.
 */
export function readsControl(
  rows: ZernioListedPost[],
  control: { postId: string; accountId: string; text: string } | null,
): { row: boolean; account: boolean; words: boolean } {
  const r = control ? rows.find((x) => x.postId === control.postId) : undefined;
  if (!r || !control) return { row: false, account: false, words: false };
  return {
    row: true,
    account: r.perPlatform.some((p) => p.accountId === control.accountId),
    words: r.content !== null && norm(r.content) === norm(control.text),
  };
}

/** What Zernio's record says for one leg, across the rows that are this send. */
export function outcomeForLeg(
  leg: { accountId: string; provider: string },
  matches: ZernioListedPost[],
): { kind: "posted" | "failed" | "in_flight"; postId: string; url: string | null; at: Date | null; reason: string | null; zernioStatus: string } | { kind: "no_entry" } {
  const entries = matches.flatMap((m) =>
    m.perPlatform
      .filter((p) => (p.accountId ? p.accountId === leg.accountId : p.platform === leg.provider.toLowerCase()))
      .map((p) => ({ p, m })),
  );
  if (!entries.length) return { kind: "no_entry" };
  const pick = (test: (s: string) => boolean) => entries.find((e) => test(e.p.status));
  const out = pick((s) => ZERNIO_POSTED.has(s));
  if (out) return { kind: "posted", postId: out.m.postId, url: out.p.url, at: out.p.publishedAt ?? out.m.scheduledFor ?? out.m.createdAt, reason: null, zernioStatus: out.p.status };
  const flying = pick((s) => !ZERNIO_FAILED.has(s));
  if (flying) return { kind: "in_flight", postId: flying.m.postId, url: null, at: null, reason: null, zernioStatus: flying.p.status };
  const dead = entries[entries.length - 1];
  return { kind: "failed", postId: dead.m.postId, url: null, at: null, reason: dead.p.error, zernioStatus: dead.p.status };
}

/**
 * Look one post up. Reads Zernio, then writes only this post's waiting legs —
 * each under a guard, so a Retry that got there first is left alone.
 */
export async function lookUpUnanswered(postId: string, actorId?: string | null): Promise<UnansweredOutcome> {
  const none = (verdict: UnansweredVerdict, detail?: string): UnansweredOutcome => ({ postId, verdict, posted: 0, failed: 0, pending: 0, detail });
  const post = await db.socialPost.findUnique({ where: { id: postId }, include: { targets: true } });
  if (!post) return none("nothing");
  const open: Leg[] = post.targets.filter(isUnanswered);
  if (!open.length) return none("nothing");

  const ws = await db.workspace.findUnique({ where: { id: post.workspaceId }, select: { zernioProfileId: true } });
  if (!ws?.zernioProfileId || !(await zernioConfigured(post.workspaceId))) return none("error", "Zernio isn't connected for this workspace.");

  // The days the send could have reached Zernio in: from the first attempt
  // (its slot, or when a Post-now post was made) to the last write on the post.
  const first = post.scheduledAt ?? post.createdAt;
  const last = post.updatedAt > first ? post.updatedAt : first;
  if (last.getTime() - first.getTime() > MAX_SPAN_DAYS * DAY) return none("unproven", `It was tried over more than ${MAX_SPAN_DAYS} days.`);
  const attempts = [first, last];

  // The control: a post this app knows went out through Zernio, near those days.
  const nearest = (await db.socialPostTarget.findMany({
    where: {
      status: "posted",
      providerPostId: { not: null },
      postedAt: { gte: new Date(first.getTime() - CONTROL_REACH_DAYS * DAY), lte: new Date(last.getTime() + CONTROL_REACH_DAYS * DAY) },
      post: { workspaceId: post.workspaceId },
    },
    select: { providerPostId: true, postedAt: true, accountId: true, post: { select: { text: true } } },
    take: 200,
  })).sort((a, b) => Math.abs(a.postedAt!.getTime() - first.getTime()) - Math.abs(b.postedAt!.getTime() - first.getTime()))[0] ?? null;
  const control = nearest ? { postId: nearest.providerPostId!, accountId: nearest.accountId, text: nearest.post.text, at: nearest.postedAt! } : null;

  const lo = Math.min(first.getTime(), control?.at.getTime() ?? Infinity) - DAY;
  const hi = Math.max(last.getTime(), control?.at.getTime() ?? -Infinity) + 2 * DAY;

  let rows: ZernioListedPost[];
  try {
    rows = await listZernioPosts({ profileId: ws.zernioProfileId, fromDate: new Date(lo), toDate: new Date(hi), workspaceId: post.workspaceId });
    // A date filter that means something other than "when it went out" would
    // hide the control (and the send with it): walk back from the newest post instead.
    if (control && !readsControl(rows, control).row) {
      const all = await listZernioPosts({ profileId: ws.zernioProfileId, workspaceId: post.workspaceId, max: 600 });
      const byId = new Map([...rows, ...all].map((r) => [r.postId, r]));
      rows = [...byId.values()];
    }
  } catch (e) {
    return none("error", e instanceof Error ? e.message : String(e));
  }
  const reads = readsControl(rows, control);

  const known = new Set(
    (await db.socialPostTarget.findMany({
      where: { providerPostId: { in: rows.map((r) => r.postId) }, post: { workspaceId: post.workspaceId } },
      select: { providerPostId: true },
    })).map((t) => t.providerPostId!),
  );
  const { matches, candidates, strangers } = matchListedPosts(post.text, open.map((t) => t.accountId), rows, known, attempts);

  if (!matches.length) {
    // "Not there" is said only when the list is proven to cover those days and
    // to tie rows to accounts — and, if other unknown posts went to these
    // accounts then, that their words can be told from this post's.
    const absent = reads.row && reads.account && !strangers && (candidates.length === 0 || reads.words);
    if (!absent) {
      return none("unproven", !control
        ? "This app has no other post from those days to check Zernio's list against."
        : !reads.row
          ? "Zernio's list for those days doesn't include a post this app knows it sent then."
          : !reads.account
            ? "Zernio's list doesn't say which account each post went to."
            : "Zernio's list holds other posts to these accounts from those days that this app can't tell from this one.");
    }
    const { count } = await db.socialPostTarget.updateMany({
      where: { id: { in: open.map((t) => t.id) }, status: "failed", providerPostId: null },
      data: { error: NO_RECORD },
    });
    await writeAudit({
      workspaceId: post.workspaceId, actorId: actorId ?? null, action: "social.unanswered_no_record", entityType: "social_post", entityId: post.id,
      meta: { legs: count, listed: rows.length, control: control?.postId ?? null, otherPostsToTheseAccounts: candidates.length },
    });
    return { postId, verdict: "no_record", posted: 0, failed: count, pending: 0 };
  }

  let posted = 0, failed = 0, pending = 0;
  for (const t of open) {
    const o = outcomeForLeg(t, matches);
    const guard = { id: t.id, status: "failed", providerPostId: null };
    if (o.kind === "posted") {
      posted += (await db.socialPostTarget.updateMany({
        where: guard,
        data: { status: "posted", providerPostId: o.postId, postedAt: o.at ?? first, error: null, ...(o.url ? { platformPostUrl: o.url } : {}) },
      })).count;
    } else if (o.kind === "in_flight") {
      pending += (await db.socialPostTarget.updateMany({ where: guard, data: { status: "pending", providerPostId: o.postId, error: inFlightNote(o.zernioStatus) } })).count;
    } else if (o.kind === "failed") {
      failed += (await db.socialPostTarget.updateMany({
        where: guard,
        data: { providerPostId: o.postId, error: (o.reason ?? `Zernio reports this ${o.zernioStatus}.`).slice(0, 500) },
      })).count;
    } else {
      failed += (await db.socialPostTarget.updateMany({ where: guard, data: { error: NO_ENTRY } })).count;
    }
  }

  // Roll the post up from its legs, as a send does — but only from the states
  // a settled send rests in, so a Retry that has claimed it isn't overwritten.
  const fresh = await db.socialPostTarget.findMany({ where: { postId: post.id }, select: { status: true, postedAt: true } });
  const status = rollUpPostStatus(fresh);
  const anyOut = fresh.some((t) => t.status === "posted");
  const firstOut = fresh.filter((t) => t.status === "posted" && t.postedAt).map((t) => t.postedAt!.getTime()).sort((a, b) => a - b)[0];
  await db.socialPost.updateMany({
    where: { id: post.id, status: { in: ["failed", "partial"] } },
    data: { status, publishedAt: anyOut ? post.publishedAt ?? (firstOut ? new Date(firstOut) : first) : null },
  });
  await writeAudit({
    workspaceId: post.workspaceId, actorId: actorId ?? null, action: "social.unanswered_settled", entityType: "social_post", entityId: post.id,
    meta: { zernioPostIds: matches.map((m) => m.postId), posted, failed, pending, status },
  });
  return { postId, verdict: "settled", posted, failed, pending };
}

let lastSweepAt = 0;

/**
 * Every workspace's unanswered sends, a few posts at a time. Rides the social
 * sweep (its lock keeps it off a send in progress) but looks only every few
 * hours: an answer that could not be had now is rarely to be had a minute
 * later, and each look is a listing call per post. `force` skips the wait.
 */
export async function settleUnansweredSends(opts: { force?: boolean } = {}): Promise<UnansweredOutcome[]> {
  const everyMin = Math.max(30, parseInt(process.env.UNANSWERED_LOOKUP_MIN ?? "360", 10) || 360);
  if (!opts.force && Date.now() - lastSweepAt < everyMin * 60_000) return [];
  lastSweepAt = Date.now();

  // The reasons `mayHavePosted` recognises, as a query; the function has the last word.
  const legs = await db.socialPostTarget.findMany({
    where: {
      status: "failed",
      providerPostId: null,
      OR: [
        { error: { contains: "may have posted", mode: "insensitive" } },
        { error: { contains: "timeout", mode: "insensitive" } },
        { error: { contains: "timed out", mode: "insensitive" } },
        { error: { contains: "time out", mode: "insensitive" } },
        { error: { contains: "aborted", mode: "insensitive" } },
      ],
      post: { updatedAt: { gte: new Date(Date.now() - MAX_AGE_DAYS * DAY) }, status: { in: ["failed", "partial"] } },
    },
    select: { postId: true, status: true, providerPostId: true, error: true },
    take: 200,
  });
  const postIds = [...new Set(legs.filter(isUnanswered).map((t) => t.postId))].slice(0, 10);
  const out: UnansweredOutcome[] = [];
  for (const id of postIds) out.push(await lookUpUnanswered(id));
  return out;
}
