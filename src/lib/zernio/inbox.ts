import { zernioJson } from "@/lib/zernio";

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
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

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
    lastMessage: str(r.lastMessage),
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
    message: String(r.message ?? ""),
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
    content: String(r.content ?? ""),
    createdTime: str(r.createdTime),
    permalink: str(r.permalink),
    picture: str(r.picture),
    commentCount: num(r.commentCount),
    likeCount: num(r.likeCount),
  }));
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
      message: String(r.message ?? ""),
      createdTime: str(r.createdTime),
      authorName: str(from.name),
      authorUsername: str(from.username),
      authorIsOwner: from.isOwner === true,
      likeCount: num(r.likeCount),
      replyCount: num(r.replyCount),
      url: str(r.url),
      canReply: r.canReply === true,
    };
  });
}
