import Link from "next/link";
import { MessagesSquare, MessageCircle, ExternalLink, Info, AlertTriangle, ArrowLeft, Heart, BellRing, Star } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { networkFor } from "@/lib/social/networks";
import { zernioConfigured } from "@/lib/zernio";
import {
  listInboxConversations,
  listInboxMessages,
  listCommentablePosts,
  listInboxComments,
  inboxSupportFor,
  messagingWindow,
  listInboxReviews,
  type InboxReview,
  type InboxConversation,
  type InboxCommentablePost,
} from "@/lib/zernio/inbox";
import { Banner, SocialHeader } from "@/components/SocialPostCard";
import { SubmitButton } from "@/components/SubmitButton";
import { markInboxEventsReadAction } from "@/app/actions/social-inbox-events";
import { InboxItemState } from "@/components/InboxItemState";
import { InboxReply } from "@/components/InboxReply";
import { DeleteButton } from "@/components/DeleteButton";
import { commentRef } from "@/lib/deletable";
import {
  sendInboxReplyAction,
  replyOnPostAction,
  replyToReviewAction,
  saveReviewReplyDraftAction,
  discardReviewReplyDraftAction,
} from "@/app/actions/social-inbox";

/**
 * Engage — the direct messages and post comments Zernio can see, in one place.
 *
 * Read-through: every list is fetched live rather than mirrored into our
 * database. There is no sync job to fall behind and no second copy to go stale,
 * at the cost of a couple of API calls per view. Threads load one at a time
 * because the comments themselves need a call per post.
 *
 * ⚠ The load-bearing honesty here is the difference between "no messages" and
 * "this network exposes no inbox". X shows nothing for the second reason —
 * `xCapabilities.inbox` is false even though its token carries dm.read/dm.write
 * — and LinkedIn has comments but no DMs. Rendering either as an empty list
 * would quietly assert nobody had written to you.
 */

type SP = { dm?: string; post?: string; acct?: string; net?: string; ok?: string; err?: string };

const DM_NETWORKS = ["facebook", "instagram", "linkedin", "twitter"];

export default async function EngagePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { dm, post, acct, net, ok, err } = await searchParams;

  const isAdmin = canAdmin(membership.role);
  // Mirrors the guard in replyOnPostAction: public comments are admin-only
  // while this workspace reviews posts. Shown as governed, not as broken.
  const commentsLocked =
    !isAdmin && (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";

  const configured = await zernioConfigured(workspace.id);
  const accounts = await db.zernioAccount.findMany({
    where: { workspaceId: workspace.id, status: "connected" },
    select: { platform: true },
  });
  // Networks we can actually read come first — a filter that always returns
  // nothing shouldn't sit at the head of the row.
  const connected = [...new Set(accounts.map((a) => a.platform))].sort((a, b) => {
    const rank = (p: string) => {
      const s = inboxSupportFor(p);
      return (s.dms ? 0 : 1) + (s.comments ? 0 : 1);
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  if (!configured) {
    return (
      <div className="p-6 w-full">
        <SocialHeader icon={<MessagesSquare className="w-6 h-6" strokeWidth={2.25} />} title="Engage" blurb="Messages and comments from your connected accounts." />
        <div className="card text-xs" style={{ borderColor: "var(--amber)" }}>
          This workspace has no Zernio API key, so there is no inbox to read.{" "}
          <Link href="/admin/connections" className="underline">Add the key</Link>.
        </div>
      </div>
    );
  }

  // One thread at a time: a message list needs its conversation's accountId,
  // and comments need their post's — Zernio 400s without them, it won't guess.
  const [conversations, posts, thread, comments, unseen, unseenTotal, reviews, reviewDrafts, dismissals] = await Promise.all([
    listInboxConversations({ workspaceId: workspace.id, platform: net, limit: 50 }).catch(() => [] as InboxConversation[]),
    listCommentablePosts({ workspaceId: workspace.id, platform: net, limit: 100 }).catch(() => [] as InboxCommentablePost[]),
    dm && acct
      ? listInboxMessages({ workspaceId: workspace.id, conversationId: dm, accountId: acct, limit: 40 }).catch(() => [])
      : Promise.resolve([]),
    post && acct
      ? listInboxComments({ workspaceId: workspace.id, postId: post, accountId: acct }).catch(() => [])
      : Promise.resolve([]),
    db.socialInboxEvent.findMany({
      where: { workspaceId: workspace.id, readAt: null },
      orderBy: { receivedAt: "desc" },
      take: 8,
    }),
    db.socialInboxEvent.count({ where: { workspaceId: workspace.id, readAt: null } }),
    db.workspace.findUnique({ where: { id: workspace.id }, select: { zernioProfileId: true } })
      .then((w) => listInboxReviews({ workspaceId: workspace.id, profileId: w?.zernioProfileId, limit: 25 }))
      .catch(() => [] as InboxReview[]),
    // Answers written but not sent. Ours, not Zernio's — a draft exists only
    // here, which is the whole point of it.
    db.inboxReplyDraft.findMany({ where: { workspaceId: workspace.id, kind: "review" } }),
    // Items this workspace decided not to answer. Also ours only: the review
    // stays public and the API keeps returning it (audit A5).
    db.socialInboxItemState.findMany({ where: { workspaceId: workspace.id } }),
  ]);

  const draftFor = new Map(reviewDrafts.map((d) => [d.targetId, d]));
  const stateOf = new Map(dismissals.map((d) => [`${d.kind}:${d.targetId}`, d]));
  const itemState = (kind: string, id: string) => (stateOf.get(`${kind}:${id}`)?.state ?? null) as "read" | "aside" | null;
  const openReviews = reviews.filter((r) => itemState("review", r.id) !== "aside");
  const asideReviews = reviews.filter((r) => itemState("review", r.id) === "aside");
  const asideConvos = conversations.filter((c) => itemState("conversation", c.id) === "aside");
  const openConvos = conversations.filter((c) => itemState("conversation", c.id) !== "aside");
  // The link every form comes back to, so a state change keeps your place.
  const backHere = net ? `/social/engage?net=${net}` : "/social/engage";

  const withComments = posts.filter((p) => p.commentCount > 0 && itemState("comment", p.id) !== "aside");
  const asideComments = posts.filter((p) => p.commentCount > 0 && itemState("comment", p.id) === "aside");
  const quiet = posts.length - withComments.length;
  const openConvo = conversations.find((c) => c.id === dm);
  const openPost = posts.find((p) => p.id === post);

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<MessagesSquare className="w-6 h-6" strokeWidth={2.25} />}
        title="Engage"
        blurb="Direct messages and comments on your posts, across every account this workspace can read."
      />

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* Network filter + what each one can actually do. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <Link href="/social/engage" className={`btn sm ${!net ? "primary" : ""}`}>All</Link>
        {connected.map((p) => {
          const n = networkFor(p);
          const sup = inboxSupportFor(p);
          const nothing = !sup.dms && !sup.comments;
          return (
            <Link
              key={p}
              href={`/social/engage?net=${p}`}
              className={`btn sm ${net === p ? "primary" : ""}`}
              title={sup.note ?? `${n?.label ?? p}: ${[sup.dms && "messages", sup.comments && "comments"].filter(Boolean).join(" + ")}`}
              style={nothing ? { opacity: 0.55 } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: n?.color ?? "var(--mute)" }} />
              {n?.label ?? p}
            </Link>
          );
        })}
      </div>

      {/* What arrived while nobody was looking. The live lists below can't
          answer this — they show the current state, not what changed. */}
      {unseen.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--amber)" }}>
          <div className="flex items-center gap-2 mb-2">
            <BellRing className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
            <h2 className="font-mono font-bold text-sm">New since you last looked</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
              {unseenTotal}
            </span>
            <span className="flex-1" />
            <form action={markInboxEventsReadAction}>
              <input type="hidden" name="back" value="/social/engage" />
              <SubmitButton className="btn sm" pendingText="Marking…">Mark all seen</SubmitButton>
            </form>
          </div>
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {unseen.map((e) => (
              <div key={e.id} className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="pt-1"><NetDot platform={e.platform} /></span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-semibold">
                    {e.authorName ?? "Someone"}
                    <span className="font-normal text-[var(--mute)]">
                      {e.kind === "comment" ? " commented"
                        : e.kind === "review" ? " left a review"
                        : e.kind === "conversation" ? " started a conversation"
                        : " sent a message"}
                    </span>
                  </span>
                  {e.preview && <span className="block text-[11px] text-[var(--mute)] truncate">{e.preview}</span>}
                </span>
                <span className="font-mono text-[9.5px] text-[var(--mute)] flex-shrink-0 pt-1">
                  {e.receivedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
              </div>
            ))}
          </div>
          {unseenTotal > unseen.length && (
            <p className="text-[11px] text-[var(--mute)] mt-2">
              …and {unseenTotal - unseen.length} more.
            </p>
          )}
        </div>
      )}

      {/* Coverage, stated once and plainly. Without this the empty columns
          below read as "nobody wrote to you", which isn't what they mean. */}
      <CoverageNote connected={connected} filtered={net} />

      {/* ── Reviews ─────────────────────────────────────────────────────────
          Their own section rather than a third column: a review is attached to
          the business, not to a post or a person, and it stays visible for
          years. */}
      {/* ⚠ Said once, plainly, so "Set aside" is never mistaken for a delete.
          A comment on our own post CAN be removed (the network decides, per
          comment); somebody else's review or message cannot be, by us or by
          anyone but them. */}
      {reviews.length > 0 && (
        <section className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
            <h2 className="font-mono font-bold text-sm">Reviews</h2>
            {/* Set-aside reviews are excluded: the count must mean "waiting on
                a person", or it nags about a decision already made (A5). */}
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
              {openReviews.filter((r) => !r.hasReply).length} unanswered
            </span>
            {/* Counted separately, never folded into "unanswered": a drafted
                reply is still an unanswered review until someone sends it. */}
            {reviewDrafts.length > 0 && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                {reviewDrafts.length} drafted
              </span>
            )}
          </div>
          {/* Visible, not just a tooltip: "Set aside" must never be mistaken
              for a delete. */}
          <p className="text-[11px] text-[var(--mute)] mb-2 mt-0">
            <b>Set aside</b> stops a review asking — it stays public on the network either way. A review can&apos;t be
            deleted from here, or by anyone but the person who wrote it; the same goes for a direct message. A comment
            on your own post <i>can</i> be deleted, and shows a delete button where the network allows it.
          </p>
          <div className="flex flex-col gap-2">
            {openReviews.map((r) => (
              <div key={`${r.platform}-${r.id}`} className="card">
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="pt-1"><NetDot platform={r.platform} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{r.reviewerName ?? "Anonymous"}</span>
                      <Rating rating={r.rating} platform={r.platform} />
                      <span className="font-mono text-[9.5px] text-[var(--mute)]">{when(r.created)}</span>
                      {r.locationName && <span className="font-mono text-[9.5px] text-[var(--mute)]">{r.locationName}</span>}
                      {r.hasReply && (
                        <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                          replied
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--slate)] whitespace-pre-wrap mt-1">{r.text || <span className="italic text-[var(--mute)]">(no written review)</span>}</p>
                  </div>
                  {r.reviewUrl && (
                    <a href={r.reviewUrl} target="_blank" rel="noreferrer" className="btn sm flex-shrink-0" title="Open on the network">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {r.hasReply ? (
                  <div className="text-xs border-l-2 pl-2 mt-2" style={{ borderColor: "var(--green)" }}>
                    <div className="font-mono text-[9.5px] text-[var(--mute)] mb-0.5">Your reply</div>
                    <p className="whitespace-pre-wrap text-[var(--slate)]">{r.replyText ?? <span className="italic text-[var(--mute)]">(reply posted, text not returned)</span>}</p>
                  </div>
                ) : (
                  <>
                    {commentsLocked && (
                      <p className="text-[11px] text-[var(--mute)] mt-2 pt-2 border-t border-[var(--line)]">
                        This workspace reviews posts before they go out, so <b>sending</b> a review reply is
                        admin-only — you can still write one and save it for an admin to release.
                      </p>
                    )}
                    <InboxReply
                      // Remounted when the saved draft changes, so discarding one
                      // clears the box instead of leaving its text behind under a
                      // note that has just disappeared.
                      key={draftFor.get(r.id)?.updatedAt.toISOString() ?? "no-draft"}
                      action={commentsLocked ? undefined : replyToReviewAction}
                      draftAction={saveReviewReplyDraftAction}
                      discardDraftAction={discardReviewReplyDraftAction}
                      initialText={draftFor.get(r.id)?.message}
                      draftNote={draftNoteFor(draftFor.get(r.id))}
                      hidden={{ reviewId: r.id, accountId: r.accountId }}
                      asLabel={r.accountUsername ?? networkFor(r.platform)?.label ?? r.platform}
                      placeholder={`Reply to ${r.reviewerName ?? "this review"}…`}
                      publicNote="public, and shown under the review for as long as it stands"
                    />
                    {/* "I've seen it" and "I'm not going to answer this" are
                        both real answers, and until now the app could hear
                        neither (audit A5). */}
                    <div className="mt-2">
                      <InboxItemState kind="review" targetId={r.id} back={backHere} state={itemState("review", r.id)} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Set aside: visible, collapsed, and reversible. Hiding them
              outright would be the app deciding what the record is. */}
          {asideReviews.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-[var(--mute)] cursor-pointer select-none">
                Set aside ({asideReviews.length}) — still public, no longer counted as work
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                {asideReviews.map((r) => {
                  const d = stateOf.get(`review:${r.id}`);
                  return (
                    <div key={`aside-${r.platform}-${r.id}`} className="card" style={{ opacity: 0.7 }}>
                      <div className="flex items-start gap-2">
                        <span className="pt-1"><NetDot platform={r.platform} /></span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold">{r.reviewerName ?? "Anonymous"}</span>
                            <span className="font-mono text-[9.5px] text-[var(--mute)]">{when(r.created)}</span>
                          </div>
                          <p className="text-xs text-[var(--slate)] whitespace-pre-wrap mt-1 line-clamp-2">{r.text}</p>
                          <p className="font-mono text-[9.5px] text-[var(--mute)] mt-1">
                            Set aside by {d?.actorName ?? "someone"}
                            {d?.reason ? ` — “${d.reason}”` : ""}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          <InboxItemState kind="review" targetId={r.id} back={backHere} state="aside" actorName={d?.actorName} reason={d?.reason} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* ── Direct messages ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <MessagesSquare className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
            <h2 className="font-mono font-bold text-sm">Direct messages</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
              {conversations.length}
            </span>
          </div>

          {openConvo ? (
            <div className="card">
              <Link href={net ? `/social/engage?net=${net}` : "/social/engage"} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-2">
                <ArrowLeft className="w-3.5 h-3.5" /> All messages
              </Link>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--line)]">
                <NetDot platform={openConvo.platform} />
                <span className="text-sm font-semibold">{openConvo.participantName ?? "Unknown sender"}</span>
                <span className="flex-1" />
                {openConvo.url && (
                  <a href={openConvo.url} target="_blank" rel="noreferrer" className="btn sm" title="Open on the network">
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {thread.length === 0 ? (
                <p className="text-xs text-[var(--mute)]">No messages came back for this thread.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {thread.map((m) => {
                    const mine = m.direction === "outgoing";
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className="max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words"
                          style={{
                            background: mine ? "var(--blue-soft)" : "var(--panel)",
                            color: mine ? "var(--blue-on)" : "var(--slate)",
                          }}
                        >
                          <div className="font-mono text-[9.5px] opacity-70 mb-0.5">
                            {mine ? "you" : (m.senderName ?? "them")} · {when(m.createdAt)}
                          </div>
                          {m.isDeleted ? <span className="italic opacity-70">(deleted)</span> : m.message}
                          {m.attachmentCount > 0 && (
                            <div className="font-mono text-[9.5px] opacity-70 mt-1">
                              {m.attachmentCount} attachment{m.attachmentCount === 1 ? "" : "s"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Meta's 24-hour rule, checked BEFORE anyone writes a reply —
                  losing a composed message to a 403 is the avoidable version
                  of this. */}
              {(() => {
                const w = messagingWindow(openConvo.platform, thread);
                return w.applies && !w.open ? (
                  <div className="mt-3 pt-3 border-t border-[var(--line)] text-[11px] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--amber-on)" }} />
                    <span className="text-[var(--mute)]">
                      <b className="text-[var(--slate)]">Outside the 24-hour reply window.</b>{" "}
                      {networkFor(openConvo.platform)?.label ?? openConvo.platform} only accepts a reply within 24
                      hours of their last message
                      {w.lastInboundAt && <> — theirs was {w.lastInboundAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</>}.
                      Sending will almost certainly be refused; they&apos;d have to write again to reopen it.
                    </span>
                  </div>
                ) : null;
              })()}
              <InboxReply
                action={sendInboxReplyAction}
                hidden={{ conversationId: openConvo.id, accountId: openConvo.accountId }}
                asLabel={openConvo.accountUsername ?? networkFor(openConvo.platform)?.label ?? openConvo.platform}
                placeholder={`Reply to ${openConvo.participantName ?? "them"}…`}
              />
            </div>
          ) : conversations.length === 0 ? (
            <EmptyOrUnsupported connected={connected} filtered={net} kind="dms" />
          ) : (
            <>
              <div className="card flex flex-col divide-y divide-[var(--line)]">
                {openConvos.map((c) => {
                  const st = itemState("conversation", c.id);
                  return (
                    // ⚠ The row is a flex CONTAINER; the link is one child and
                    // the state buttons another. They used to be one <Link>
                    // wrapping everything, and a button inside an anchor is
                    // invalid HTML the parser reshuffles — the same nesting
                    // trap that made the Inbox's Dismiss submit the wrong
                    // action.
                    <div key={`${c.platform}-${c.id}`} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0" style={st === "read" ? { opacity: 0.72 } : undefined}>
                      <Link
                        href={`/social/engage?dm=${encodeURIComponent(c.id)}&acct=${encodeURIComponent(c.accountId)}${net ? `&net=${net}` : ""}`}
                        className="flex items-start gap-2 flex-1 min-w-0 group"
                      >
                        <span className="pt-1"><NetDot platform={c.platform} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className={`text-xs truncate group-hover:underline ${st === "read" ? "font-normal" : "font-semibold"}`}>{c.participantName ?? "Unknown sender"}</span>
                            {c.unreadCount > 0 && (
                              <span className="font-mono text-[9px] px-1.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                                {c.unreadCount}
                              </span>
                            )}
                          </span>
                          <span className="block text-[11px] text-[var(--mute)] truncate">{c.lastMessage ?? "—"}</span>
                        </span>
                        <span className="font-mono text-[9.5px] text-[var(--mute)] flex-shrink-0 pt-1">{when(c.updatedTime)}</span>
                      </Link>
                      <span className="flex-shrink-0 pt-0.5">
                        <InboxItemState kind="conversation" targetId={c.id} back={backHere} state={st} compact />
                      </span>
                    </div>
                  );
                })}
                {openConvos.length === 0 && (
                  <p className="text-xs text-[var(--mute)] py-2 m-0">Every thread has been set aside.</p>
                )}
              </div>

              {asideConvos.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-[var(--mute)] cursor-pointer select-none">
                    Set aside ({asideConvos.length}) — still in the other person&apos;s inbox, no longer counted as work
                  </summary>
                  <div className="card flex flex-col divide-y divide-[var(--line)] mt-2" style={{ opacity: 0.7 }}>
                    {asideConvos.map((c) => {
                      const d = stateOf.get(`conversation:${c.id}`);
                      return (
                        <div key={`aside-${c.platform}-${c.id}`} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                          <span className="pt-1"><NetDot platform={c.platform} /></span>
                          <span className="flex-1 min-w-0">
                            <span className="text-xs font-semibold truncate">{c.participantName ?? "Unknown sender"}</span>
                            <span className="block text-[11px] text-[var(--mute)] truncate">{c.lastMessage ?? "—"}</span>
                          </span>
                          <span className="flex-shrink-0">
                            <InboxItemState kind="conversation" targetId={c.id} back={backHere} state="aside" actorName={d?.actorName} reason={d?.reason} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
        </section>

        {/* ── Comments ────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
            <h2 className="font-mono font-bold text-sm">Comments on your posts</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
              {withComments.length}
            </span>
          </div>

          {openPost ? (
            <div className="card">
              <Link href={net ? `/social/engage?net=${net}` : "/social/engage"} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-2">
                <ArrowLeft className="w-3.5 h-3.5" /> All posts
              </Link>
              <div className="flex items-start gap-2 mb-3 pb-2 border-b border-[var(--line)]">
                <span className="pt-0.5"><NetDot platform={openPost.platform} /></span>
                <p className="flex-1 text-xs text-[var(--slate)] line-clamp-3">{openPost.content}</p>
                {openPost.permalink && (
                  <a href={openPost.permalink} target="_blank" rel="noreferrer" className="btn sm flex-shrink-0" title="Open the post">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {comments.length === 0 ? (
                <p className="text-xs text-[var(--mute)]">No comments came back for this post.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {comments.map((c) => (
                    <div key={c.id} className="text-xs border-l-2 pl-2" style={{ borderColor: c.authorIsOwner ? "var(--blue)" : "var(--line-2)" }}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[9.5px] text-[var(--mute)] mb-0.5">
                            {c.authorName ?? "Unknown"}{c.authorIsOwner ? " (you)" : ""} · {when(c.createdTime)}
                            {c.likeCount > 0 && <> · {c.likeCount} like{c.likeCount === 1 ? "" : "s"}</>}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-[var(--slate)]">{c.message}</p>
                        </div>
                        {/* Shown only where the NETWORK says we may — `canDelete`
                            is true for our own comments and for others' on a page
                            we administer. A button that always 403s would read as
                            broken rather than as governed. */}
                        {/* ⚠ BOTH gates. `canDelete` is the NETWORK's verdict;
                            DELETABLE.zernioComment.role is "ADMIN", and
                            deleteEntityAction redirects a non-admin to
                            /forbidden — so an EDITOR was shown a button that
                            threw them off the page. */}
                        {c.canDelete && isAdmin && (
                          <DeleteButton
                            kind="zernioComment"
                            id={commentRef(openPost.id, c.id, openPost.accountId)}
                            name={c.message.slice(0, 60)}
                            returnTo={`/social/engage?post=${encodeURIComponent(openPost.id)}&acct=${encodeURIComponent(openPost.accountId)}`}
                            iconOnly
                            className="btn sm flex-shrink-0"
                          />
                        )}
                        {c.canDelete && !isAdmin && (
                          <span className="font-mono text-[9.5px] text-[var(--mute)] flex-shrink-0 pt-0.5" title="deleteEntityAction requires ADMIN">
                            admin removes
                          </span>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              )}
              {commentsLocked ? (
                <p className="text-[11px] mt-3 pt-3 border-t border-[var(--line)] text-[var(--mute)]">
                  This workspace reviews posts before they go out, so public comments are admin-only. Direct-message
                  replies are still yours to send.
                </p>
              ) : (
                <InboxReply
                  action={replyOnPostAction}
                  hidden={{ postId: openPost.id, accountId: openPost.accountId }}
                  asLabel={openPost.accountUsername ?? networkFor(openPost.platform)?.label ?? openPost.platform}
                  placeholder="Add a comment on this post…"
                  // Not a threaded reply — say so, because "reply" implies one.
                  publicNote="posts publicly as a new comment on the post, not threaded under a reply"
                />
              )}
            </div>
          ) : withComments.length === 0 ? (
            <>
              <EmptyOrUnsupported connected={connected} filtered={net} kind="comments" />
              {quiet > 0 && (
                <p className="text-[11px] text-[var(--mute)] mt-2">
                  {quiet} published post{quiet === 1 ? "" : "s"} checked — none has a comment on it yet.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="card flex flex-col divide-y divide-[var(--line)]">
                {/* ⚠ State lives on the POST, not on each comment, because a
                    comment webhook stores the POST id as its threadId
                    (api/zernio/webhook/route.ts:180). Keyed per comment it
                    would match no event, hide nothing, and still report
                    success — a button that does nothing. */}
                {withComments.map((p) => {
                  const st = itemState("comment", p.id);
                  return (
                    <div key={`${p.platform}-${p.id}`} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0" style={st === "read" ? { opacity: 0.72 } : undefined}>
                      <Link
                        href={`/social/engage?post=${encodeURIComponent(p.id)}&acct=${encodeURIComponent(p.accountId)}${net ? `&net=${net}` : ""}`}
                        className="flex items-start gap-2 flex-1 min-w-0 group"
                      >
                        <span className="pt-1"><NetDot platform={p.platform} /></span>
                        <span className="flex-1 min-w-0 text-xs text-[var(--slate)] truncate group-hover:underline">{p.content}</span>
                        <span className="flex items-center gap-2 flex-shrink-0 font-mono text-[9.5px] text-[var(--mute)] pt-0.5">
                          <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" />{p.commentCount}</span>
                          {p.likeCount > 0 && <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" />{p.likeCount}</span>}
                        </span>
                      </Link>
                      <span className="flex-shrink-0 pt-0.5">
                        <InboxItemState kind="comment" targetId={p.id} back={backHere} state={st} compact />
                      </span>
                    </div>
                  );
                })}
              </div>
              {quiet > 0 && (
                <p className="text-[11px] text-[var(--mute)] mt-2">
                  {quiet} more published post{quiet === 1 ? "" : "s"} have no comments yet.
                </p>
              )}
              {asideComments.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-[var(--mute)] cursor-pointer select-none">
                    Set aside ({asideComments.length}) — the comments are still on the post
                  </summary>
                  <div className="card flex flex-col divide-y divide-[var(--line)] mt-2" style={{ opacity: 0.7 }}>
                    {asideComments.map((p) => {
                      const d = stateOf.get(`comment:${p.id}`);
                      return (
                        <div key={`aside-${p.platform}-${p.id}`} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                          <span className="pt-1"><NetDot platform={p.platform} /></span>
                          <span className="flex-1 min-w-0 text-xs text-[var(--slate)] truncate">{p.content}</span>
                          <span className="flex-shrink-0">
                            <InboxItemState kind="comment" targetId={p.id} back={backHere} state="aside" actorName={d?.actorName} reason={d?.reason} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Per-network coverage, so an empty column is never mistaken for silence. */
function CoverageNote({ connected, filtered }: { connected: string[]; filtered?: string }) {
  const shown = filtered ? [filtered] : connected;
  const limited = shown
    .map((p) => ({ p, label: networkFor(p)?.label ?? p, sup: inboxSupportFor(p) }))
    .filter(({ sup }) => sup.note);
  if (limited.length === 0) return null;
  return (
    <div className="card mb-4 flex items-start gap-2.5" style={{ borderColor: "var(--line)" }}>
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--blue-on)" }} />
      <div className="text-[11px] text-[var(--mute)] leading-relaxed">
        <b className="text-[var(--slate)]">What each network exposes.</b>
        <ul className="mt-1 mb-1.5 flex flex-col gap-0.5">
          {limited.map(({ p, label, sup }) => (
            // Name the network. An unattributed limitation is unactionable.
            <li key={p}><b className="text-[var(--slate)]">{label}</b> — {sup.note}.</li>
          ))}
        </ul>
        None of that is a count of zero: these are limits of the integration, not quiet audiences.
      </div>
    </div>
  );
}

/**
 * The empty state that has to tell the truth: is this network silent, or can we
 * simply not see it?
 */
function EmptyOrUnsupported({
  connected, filtered, kind,
}: { connected: string[]; filtered?: string; kind: "dms" | "comments" }) {
  const shown = filtered ? [filtered] : connected.filter((p) => DM_NETWORKS.includes(p) || kind === "comments");
  const supported = shown.filter((p) => (kind === "dms" ? inboxSupportFor(p).dms : inboxSupportFor(p).comments));
  const unsupported = shown.filter((p) => !(kind === "dms" ? inboxSupportFor(p).dms : inboxSupportFor(p).comments));

  if (supported.length === 0) {
    return (
      <div className="card text-xs flex items-start gap-2" style={{ borderColor: "var(--amber)" }}>
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--amber-on)" }} />
        <span>
          <b>Not available</b>, rather than empty.{" "}
          {unsupported.map((p) => networkFor(p)?.label ?? p).join(", ")} expose{unsupported.length === 1 ? "s" : ""} no{" "}
          {kind === "dms" ? "direct messages" : "comments"} through Zernio, so there is nothing to show — this is not
          a report that nobody wrote.
        </span>
      </div>
    );
  }
  return (
    <div className="card text-xs text-[var(--mute)]">
      Nothing yet on {supported.map((p) => networkFor(p)?.label ?? p).join(", ")}.
      {unsupported.length > 0 && (
        <> {unsupported.map((p) => networkFor(p)?.label ?? p).join(", ")} can&apos;t be read at all, so {unsupported.length === 1 ? "it isn't" : "they aren't"} counted here.</>
      )}
    </div>
  );
}

/**
 * A star rating, or an honest absence.
 *
 * ⚠ Facebook Pages have no star ratings — they use Recommendations, and a real
 * Facebook review comes back with NO `rating` field at all (verified on all
 * three live reviews). Rendering that as ☆☆☆☆☆ or 0/5 would turn a compliment
 * into a one-star. Null means "this network doesn't rate", which is a
 * different fact from "rated zero", so it says so.
 */
function Rating({ rating, platform }: { rating: number | null; platform: string }) {
  if (rating === null) {
    return (
      <span className="font-mono text-[9.5px] text-[var(--mute)]" title={`${networkFor(platform)?.label ?? platform} uses recommendations rather than star ratings`}>
        no rating
      </span>
    );
  }
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      className="font-mono text-[11px]"
      style={{ color: full <= 2 ? "var(--rose-on)" : full >= 4 ? "var(--green-on)" : "var(--amber-on)" }}
      title={`${rating} out of 5`}
    >
      {"★".repeat(full)}{"☆".repeat(5 - full)} {rating}/5
    </span>
  );
}

function NetDot({ platform }: { platform: string }) {
  const n = networkFor(platform);
  return <span className="w-2 h-2 rounded-full block flex-shrink-0" title={n?.label ?? platform} style={{ background: n?.color ?? "var(--mute)" }} />;
}

/**
 * "Draft saved 10 Aug by Idris", or nothing at all when there is no draft.
 *
 * Undefined rather than an empty string on purpose: it is the single switch
 * that turns the note, the amber styling and the Discard button on together,
 * so none of them can appear without the other two.
 */
function draftNoteFor(draft?: { updatedAt: Date; authorName: string | null }): string | undefined {
  if (!draft) return undefined;
  return `Draft saved ${when(draft.updatedAt.toISOString())}${draft.authorName ? ` by ${draft.authorName}` : ""}`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
