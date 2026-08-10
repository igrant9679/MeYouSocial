import { zernioJson, zernioSend, zernioDelete } from "@/lib/zernio";

/**
 * Zernio's inbox: direct messages, and comments on posts we published.
 *
 * ⚠ COVERAGE IS NOT UNIFORM, and it is not a matter of having no messages —
 * two of the three networks simply expose nothing. Probed against both tenants'
 * live keys on 2026-08-08:
 *
 *   Facebook    DMs ✅ (LSI 11, CF 6)      comments ✅
 *   LinkedIn    DMs ✗ none, ever           comments ✅ (LSI 39, CF 57 posts)
 *   X (Twitter) DMs ✗                      comments ✗   — `xCapabilities.inbox`
 *               is false on the account despite the token holding dm.read
 *               and dm.write, so the scopes are there and the feature is not.
 *   Instagram   DMs ✅ (LSI 8)             comments ✅ (CF 42)
 *
 * That distinction has to survive all the way to the screen. An empty list
 * under "X" would say "nobody messaged you"; the truth is "we cannot see it",
 * and those are different facts — the same rule the rest of this codebase
 * follows when a number is unknown rather than zero.
 *
 * ⚠ Zernio answers HTTP 200 with the marketing site's HTML for any path it
 * doesn't route. Status codes prove nothing here; `zernioJson` checks the
 * content-type, which is the only reliable signal that a route exists.
 */

/**
 * What each network's inbox actually offers, as measured — not as documented.
 *
 * `note` is a PHRASE, not a sentence: the caller renders it after the network's
 * own label ("X — no inbox at all…"). Keeping the name out of the string is
 * what stops an unnamed "no inbox support recorded for this network" appearing
 * twice in a row with no clue which networks it meant.
 */
export type InboxSupport = { dms: boolean; comments: boolean; note?: string };

export const INBOX_SUPPORT: Record<string, InboxSupport> = {
  facebook: { dms: true, comments: true },
  instagram: { dms: true, comments: true },
  linkedin: { dms: false, comments: true, note: "comments only — it exposes no direct messages through Zernio" },
  twitter: {
    dms: false, comments: false,
    note: "no inbox at all — Zernio's inbox capability is switched off on the account, even though its token carries dm.read and dm.write",
  },
  pinterest: { dms: false, comments: false, note: "no inbox through Zernio" },
  youtube: { dms: false, comments: false, note: "no inbox through Zernio" },
};

export function inboxSupportFor(platform: string): InboxSupport {
  // Unknown networks get the same honest phrasing rather than a vague
  // "not recorded", which reads like our bookkeeping failed rather than like
  // the integration has no such surface.
  return INBOX_SUPPORT[platform.trim().toLowerCase()] ?? { dms: false, comments: false, note: "no inbox through Zernio" };
}

export type InboxConversation = {
  id: string;
  accountId: string;
  accountUsername: string | null;
  platform: string;
  participantName: string | null;
  participantUsername: string | null;
  participantPicture: string | null;
  lastMessage: string | null;
  updatedTime: string | null;
  unreadCount: number;
  url: string | null;
};

export type InboxMessage = {
  id: string;
  conversationId: string;
  platform: string;
  message: string;
  senderName: string | null;
  /** "incoming" = them, "outgoing" = us. */
  direction: string;
  createdAt: string | null;
  attachmentCount: number;
  isDeleted: boolean;
};

/** A post we published that can carry comments — NOT a comment itself. */
export type InboxCommentablePost = {
  id: string;
  accountId: string;
  accountUsername: string | null;
  platform: string;
  content: string;
  createdTime: string | null;
  permalink: string | null;
  picture: string | null;
  commentCount: number;
  likeCount: number;
};

export type InboxComment = {
  id: string;
  message: string;
  createdTime: string | null;
  authorName: string | null;
  authorUsername: string | null;
  authorIsOwner: boolean;
  likeCount: number;
  replyCount: number;
  url: string | null;
  canReply: boolean;
  /** The NETWORK's verdict on whether we may remove this one — not ours. */
  canDelete: boolean;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * LinkedIn returns hashtags in its own wire markup — `{hashtag|\#|Foo}` — which
 * is what a person wrote as `#Foo`. Rendering the raw form makes real posts
 * look corrupted. Left as plain text rather than linkified: this is somebody
 * else's content and we are only displaying it.
 */
export function readableText(s: string): string {
  return s.replace(/\{hashtag\|\\?#\|([^}]+)\}/g, "#$1");
}

/** Direct-message threads across every account on the workspace's profile. */
export async function listInboxConversations(opts: {
  workspaceId: string;
  platform?: string;
  limit?: number;
}): Promise<InboxConversation[]> {
  const qs = new URLSearchParams({ page: "1", limit: String(Math.min(100, opts.limit ?? 50)) });
  if (opts.platform) qs.set("platform", opts.platform);
  const body = await zernioJson(`/inbox/conversations?${qs}`, opts.workspaceId);
  const rows = (body?.data ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id ?? ""),
    accountId: String(r.accountId ?? ""),
    accountUsername: str(r.accountUsername),
    platform: String(r.platform ?? "").toLowerCase(),
    participantName: str(r.participantName),
    participantUsername: str(r.participantUsername),
    participantPicture: str(r.participantPicture),
    lastMessage: str(r.lastMessage) === null ? null : readableText(String(r.lastMessage)),
    updatedTime: str(r.updatedTime),
    unreadCount: num(r.unreadCount),
    url: str(r.url),
  }));
}

/** ⚠ `accountId` is REQUIRED — without it Zernio 400s, it does not guess. */
export async function listInboxMessages(opts: {
  workspaceId: string;
  conversationId: string;
  accountId: string;
  limit?: number;
}): Promise<InboxMessage[]> {
  const qs = new URLSearchParams({ accountId: opts.accountId, limit: String(Math.min(100, opts.limit ?? 30)) });
  const body = await zernioJson(`/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages?${qs}`, opts.workspaceId);
  const rows = (body?.messages ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id ?? ""),
    conversationId: String(r.conversationId ?? ""),
    platform: String(r.platform ?? "").toLowerCase(),
    message: readableText(String(r.message ?? "")),
    senderName: str(r.senderName),
    direction: String(r.direction ?? "incoming"),
    createdAt: str(r.createdAt) ?? str(r.sentAt),
    attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
    isDeleted: r.isDeleted === true,
  }));
}

/**
 * Posts that can carry comments.
 *
 * ⚠ The endpoint is called `/inbox/comments` but returns POSTS, each with a
 * `commentCount`. The comments themselves need a second call per post
 * (`listInboxComments`), so a "show me every comment" view would be N+1 against
 * a rate-limited API — which is why the surface lists posts and fetches one
 * thread at a time.
 */
export async function listCommentablePosts(opts: {
  workspaceId: string;
  platform?: string;
  limit?: number;
}): Promise<InboxCommentablePost[]> {
  const qs = new URLSearchParams({ page: "1", limit: String(Math.min(100, opts.limit ?? 100)) });
  if (opts.platform) qs.set("platform", opts.platform);
  const body = await zernioJson(`/inbox/comments?${qs}`, opts.workspaceId);
  const rows = (body?.data ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id ?? ""),
    accountId: String(r.accountId ?? ""),
    accountUsername: str(r.accountUsername),
    platform: String(r.platform ?? "").toLowerCase(),
    content: readableText(String(r.content ?? "")),
    createdTime: str(r.createdTime),
    permalink: str(r.permalink),
    picture: str(r.picture),
    commentCount: num(r.commentCount),
    likeCount: num(r.likeCount),
  }));
}

/**
 * Meta's 24-hour messaging window, computed from the thread we already have.
 *
 * Facebook Messenger and Instagram only allow a business to send inside 24
 * hours of the PERSON's last message — an outgoing message doesn't reset it.
 * Proven the hard way on 2026-08-08: a test reply into a thread whose last
 * inbound was June 2024 came back
 * `HTTP 403 {"error":"This message is sent outside of allowed window.",
 * platformError:{code:10,subcode:2534022,type:"IGApiException"}}`.
 *
 * Worth computing up front rather than letting people write a reply and lose
 * it to a 403 — the thread already carries every timestamp needed.
 *
 * ⚠ Returns `open: true` when we simply can't tell (no inbound message in the
 * page we fetched). Guessing "closed" would hide a Send button that might work,
 * and exceptions do exist (Meta's human-agent tag widens the window to 7 days).
 */
const WINDOWED_PLATFORMS = new Set(["facebook", "instagram"]);
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function messagingWindow(
  platform: string,
  messages: InboxMessage[],
): { applies: boolean; open: boolean; lastInboundAt: Date | null } {
  if (!WINDOWED_PLATFORMS.has(platform.trim().toLowerCase())) {
    return { applies: false, open: true, lastInboundAt: null };
  }
  const inbound = messages
    .filter((m) => m.direction === "incoming" && m.createdAt)
    .map((m) => new Date(m.createdAt as string))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  const last = inbound[0] ?? null;
  if (!last) return { applies: true, open: true, lastInboundAt: null };
  return { applies: true, open: Date.now() - last.getTime() < WINDOW_MS, lastInboundAt: last };
}

/**
 * Turn a raw send failure into something a person can act on.
 *
 * The house rule from the OpenAI unverified-org 429 and the stale-page error:
 * translate at the source, and name the fix. A wall of JSON with an fbtraceId
 * tells the author nothing about what to do next.
 */
export function explainInboxSendError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("outside of allowed window") || s.includes("2534022")) {
    return "Instagram and Facebook only let you reply within 24 hours of someone's last message, and this thread is past that. They'd have to message again to reopen it — or reply from the network itself.";
  }
  if (s.includes("http 401") || s.includes("http 403")) {
    return `The network refused this account. It may need reconnecting under Admin → Connections. (${raw.slice(0, 200)})`;
  }
  if (s.includes("http 429") || s.includes("rate limit")) {
    return "The network is rate-limiting this account right now — try again shortly.";
  }
  return raw;
}

/**
 * Send a direct message into an existing conversation.
 *
 * ⚠ `accountId` goes in the BODY, not the query string — passing it as a query
 * param returns `missing_required_field: accountId` even though the same
 * endpoint reads it from the query on GET. Mapped 2026-08-08 by POSTing
 * deliberately incomplete bodies and reading the validation errors, so the
 * contract was learned without delivering anything to anyone.
 *
 * This REACHES A REAL PERSON. Callers must have a human behind them.
 */
export async function sendInboxMessage(opts: {
  workspaceId: string;
  conversationId: string;
  accountId: string;
  message: string;
}): Promise<void> {
  await zernioSend(
    `/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages`,
    { accountId: opts.accountId, message: opts.message },
    opts.workspaceId,
  );
}

/**
 * Comment on one of our own posts — this is how a comment gets answered.
 *
 * ⚠ It posts a NEW top-level comment on the post; it does not thread under the
 * comment being answered. Zernio's comment rows carry `canReply` and a
 * `replies` array, so a threaded form may exist, but determining its shape
 * would have meant POSTing a valid message to find out — i.e. publishing a
 * test comment on a real company page. Not worth it; the UI says plainly what
 * this does instead.
 *
 * Same warning as above: this is public and immediate.
 */
export async function replyOnPost(opts: {
  workspaceId: string;
  postId: string;
  accountId: string;
  message: string;
}): Promise<void> {
  await zernioSend(
    `/inbox/comments/${encodeURIComponent(opts.postId)}`,
    { accountId: opts.accountId, message: opts.message },
    opts.workspaceId,
  );
}

/**
 * A review on a connected account.
 *
 * ⚠ `rating` IS GENUINELY ABSENT ON FACEBOOK. Facebook retired star ratings for
 * Pages in favour of Recommendations, so a real Facebook review carries text,
 * a reviewer and nothing numeric — verified against all three live reviews on
 * 2026-08-10. Rendering it as 0/5 would invent a one-star out of a compliment;
 * null means "this network doesn't rate", which is a different fact from "rated
 * zero". Google Business does send 1–5.
 */
export type InboxReview = {
  id: string;
  platform: string;
  accountId: string;
  accountUsername: string | null;
  reviewerName: string | null;
  text: string;
  created: string | null;
  /** Null on Facebook — see above. Never coerce this to a number. */
  rating: number | null;
  hasReply: boolean;
  replyText: string | null;
  reviewUrl: string | null;
  locationName: string | null;
};

export async function listInboxReviews(opts: {
  workspaceId: string;
  profileId?: string | null;
  limit?: number;
}): Promise<InboxReview[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(50, opts.limit ?? 25)) });
  if (opts.profileId) qs.set("profileId", opts.profileId);
  const body = await zernioJson(`/inbox/reviews?${qs}`, opts.workspaceId);
  const rows = (body?.data ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const reviewer = (r.reviewer ?? {}) as Record<string, unknown>;
    const reply = (r.reply ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      platform: String(r.platform ?? "").toLowerCase(),
      accountId: String(r.accountId ?? ""),
      accountUsername: str(r.accountUsername),
      reviewerName: str(reviewer.name),
      text: readableText(String(r.text ?? "")),
      created: str(r.created),
      // Only a real number counts. `undefined`, null and "" all mean unrated.
      rating: typeof r.rating === "number" && Number.isFinite(r.rating) ? r.rating : null,
      hasReply: r.hasReply === true,
      replyText: str(reply.text),
      reviewUrl: str(r.reviewUrl),
      locationName: str(r.locationName),
    };
  });
}

/**
 * Reply to a review. Public and immediate, like a comment.
 *
 * ⚠ The id must be URL-ENCODED — Google Business review ids are path-shaped
 * (`accounts/…/locations/…/reviews/…`) and would otherwise break the route.
 * Facebook's are numeric, so encoding is harmless there.
 */
export async function replyToInboxReview(opts: {
  workspaceId: string;
  reviewId: string;
  accountId: string;
  message: string;
}): Promise<void> {
  await zernioSend(
    `/inbox/reviews/${encodeURIComponent(opts.reviewId)}/reply`,
    { accountId: opts.accountId, message: opts.message },
    opts.workspaceId,
  );
}

/** The actual comments on one post. `accountId` is required, as above. */
export async function listInboxComments(opts: {
  workspaceId: string;
  postId: string;
  accountId: string;
}): Promise<InboxComment[]> {
  const qs = new URLSearchParams({ accountId: opts.accountId });
  const body = await zernioJson(`/inbox/comments/${encodeURIComponent(opts.postId)}?${qs}`, opts.workspaceId);
  const rows = (body?.comments ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const from = (r.from ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      message: readableText(String(r.message ?? "")),
      createdTime: str(r.createdTime),
      authorName: str(from.name),
      authorUsername: str(from.username),
      authorIsOwner: from.isOwner === true,
      likeCount: num(r.likeCount),
      replyCount: num(r.replyCount),
      url: str(r.url),
      canReply: r.canReply === true,
      canDelete: r.canDelete === true,
    };
  });
}

/**
 * Remove one comment from a post.
 *
 * ⚠ Needs THREE ids: the post it sits under, the comment itself, and the
 * account whose permissions authorise it. Mapped 2026-08-08 with deliberately
 * bogus ids so nothing real was touched — the endpoint reports
 * `missing_required_field: commentId` until both are present, then hands the
 * request to the network (a bogus comment id came back as Facebook's own
 * "Platform error: 100").
 *
 * Whether a comment MAY be deleted is the network's call, not ours: each row
 * carries `canDelete`, true for our own comments and for others' comments on a
 * page we administer. Proven end to end on 2026-08-08 — a test comment posted
 * and removed, `{"message":"Comment deleted successfully"}`.
 */
export async function deleteInboxComment(opts: {
  workspaceId: string;
  postId: string;
  commentId: string;
  accountId: string;
}): Promise<void> {
  const qs = new URLSearchParams({ accountId: opts.accountId, commentId: opts.commentId });
  await zernioDelete(`/inbox/comments/${encodeURIComponent(opts.postId)}?${qs}`, opts.workspaceId);
}
