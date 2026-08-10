import Link from "next/link";
import { MessagesSquare, MessageCircle, ExternalLink, Info, AlertTriangle, ArrowLeft, Heart, BellRing } from "lucide-react";
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
  type InboxConversation,
  type InboxCommentablePost,
} from "@/lib/zernio/inbox";
import { Banner, SocialHeader } from "@/components/SocialPostCard";
import { SubmitButton } from "@/components/SubmitButton";
import { markInboxEventsReadAction } from "@/app/actions/social-inbox-events";
import { InboxReply } from "@/components/InboxReply";
import { DeleteButton } from "@/components/DeleteButton";
import { commentRef } from "@/lib/deletable";
import { sendInboxReplyAction, replyOnPostAction } from "@/app/actions/social-inbox";

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
  const [conversations, posts, thread, comments, unseen, unseenTotal] = await Promise.all([
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
  ]);

  const withComments = posts.filter((p) => p.commentCount > 0);
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
                      {e.kind === "comment" ? " commented" : e.kind === "conversation" ? " started a conversation" : " sent a message"}
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
            <div className="card flex flex-col divide-y divide-[var(--line)]">
              {conversations.map((c) => (
                <Link
                  key={`${c.platform}-${c.id}`}
                  href={`/social/engage?dm=${encodeURIComponent(c.id)}&acct=${encodeURIComponent(c.accountId)}${net ? `&net=${net}` : ""}`}
                  className="flex items-start gap-2 py-2 first:pt-0 last:pb-0 group"
                >
                  <span className="pt-1"><NetDot platform={c.platform} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold truncate group-hover:underline">{c.participantName ?? "Unknown sender"}</span>
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
              ))}
            </div>
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
                        {c.canDelete && (
                          <DeleteButton
                            kind="zernioComment"
                            id={commentRef(openPost.id, c.id, openPost.accountId)}
                            name={c.message.slice(0, 60)}
                            returnTo={`/social/engage?post=${encodeURIComponent(openPost.id)}&acct=${encodeURIComponent(openPost.accountId)}`}
                            iconOnly
                            className="btn sm flex-shrink-0"
                          />
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
                {withComments.map((p) => (
                  <Link
                    key={`${p.platform}-${p.id}`}
                    href={`/social/engage?post=${encodeURIComponent(p.id)}&acct=${encodeURIComponent(p.accountId)}${net ? `&net=${net}` : ""}`}
                    className="flex items-start gap-2 py-2 first:pt-0 last:pb-0 group"
                  >
                    <span className="pt-1"><NetDot platform={p.platform} /></span>
                    <span className="flex-1 min-w-0 text-xs text-[var(--slate)] truncate group-hover:underline">{p.content}</span>
                    <span className="flex items-center gap-2 flex-shrink-0 font-mono text-[9.5px] text-[var(--mute)] pt-0.5">
                      <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" />{p.commentCount}</span>
                      {p.likeCount > 0 && <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" />{p.likeCount}</span>}
                    </span>
                  </Link>
                ))}
              </div>
              {quiet > 0 && (
                <p className="text-[11px] text-[var(--mute)] mt-2">
                  {quiet} more published post{quiet === 1 ? "" : "s"} have no comments yet.
                </p>
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

function NetDot({ platform }: { platform: string }) {
  const n = networkFor(platform);
  return <span className="w-2 h-2 rounded-full block flex-shrink-0" title={n?.label ?? platform} style={{ background: n?.color ?? "var(--mute)" }} />;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
