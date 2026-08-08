import Link from "next/link";
import {
  Send, Copy, Trash2, RotateCw, Check, X, Pencil, Tags, ListPlus, Megaphone, Recycle, ShieldCheck,
} from "lucide-react";
import { storage } from "@/lib/storage";
import { networkFor } from "@/lib/social/networks";
import {
  approveSocialPostAction,
  requestChangesSocialPostAction,
  submitForApprovalAction,
} from "@/app/actions/social-workflow";
import { queueSocialPostAction } from "@/app/actions/social-slots";
import {
  publishNowAction,
  cancelScheduledAction,
  deleteSocialPostAction,
  duplicateSocialPostAction,
} from "@/app/actions/social";

/**
 * The post card, and the small shared chrome around it.
 *
 * Extracted from the old single-page /social when the section became a set of
 * tabs: Overview, Calendar, Approvals and Performance all render posts, and a
 * card that drifts between them would show different controls for the same post
 * depending on where you happened to be standing.
 *
 * Server component on purpose — every control is a server-action form, so there
 * is no client JS here at all.
 */

export const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  scheduled: { bg: "var(--blue-soft)", fg: "var(--blue-on)", label: "scheduled" },
  publishing: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "publishing" },
  posted: { bg: "var(--green-soft)", fg: "var(--green-on)", label: "posted" },
  partial: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "partly posted" },
  failed: { bg: "var(--rose-soft)", fg: "var(--rose-on)", label: "failed" },
  draft: { bg: "var(--panel)", fg: "var(--mute)", label: "draft" },
};

export type PostRow = {
  id: string;
  text: string;
  mediaKeys: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  topic: { name: string } | null;
  campaign: { name: string; color: string | null } | null;
  category: string | null;
  evergreen: boolean;
  recycleEveryDays: number;
  timesRecycled: number;
  recycledFrom: { id: string } | null;
  approval: string | null;
  reviewNote: string | null;
  targets: {
    id: string; provider: string; accountName: string | null; text: string | null;
    mediaKeys: string | null; status: string; error: string | null;
  }[];
};

/** The image keys a JSON key array holds ([] for null/malformed). */
export function listKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Thumbnail strip for stored media keys; each opens full-size in a new tab. */
export function MediaThumbs({ keys, size = "h-20 w-20" }: { keys: string[]; size?: string }) {
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <a key={k} href={storage.url(k)} target="_blank" rel="noreferrer" title="Open full size">
          <img
            src={storage.url(k)}
            alt="Post image"
            loading="lazy"
            className={`${size} rounded-lg object-cover border border-[var(--line)]`}
          />
        </a>
      ))}
    </div>
  );
}

export function PostCard({
  post, canQueue = false, timeZone, isAdmin = false, approvalOn = false,
}: {
  post: PostRow; canQueue?: boolean; timeZone: string; isAdmin?: boolean; approvalOn?: boolean;
}) {
  const s = STATUS_STYLE[post.status] ?? STATUS_STYLE.draft;
  const when = post.scheduledAt ?? post.publishedAt;
  const canRetry = post.status === "failed" || post.status === "partial";
  const held = post.approval === "pending" || post.approval === "changes";
  // Held posts hide the send buttons — the server refuses anyway, but showing
  // controls that always fail reads as broken rather than as governed.
  const unsent = (post.status === "draft" || post.status === "scheduled") && !held;
  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
        {post.approval === "pending" && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
            <ShieldCheck className="w-2.5 h-2.5" /> awaiting approval
          </span>
        )}
        {post.approval === "changes" && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title={post.reviewNote ?? undefined} style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            <ShieldCheck className="w-2.5 h-2.5" /> changes requested
          </span>
        )}
        {post.topic && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
            <Tags className="w-2.5 h-2.5" /> {post.topic.name}
          </span>
        )}
        {post.campaign && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
            <Megaphone className="w-2.5 h-2.5" /> {post.campaign.name}
          </span>
        )}
        {post.category && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
            {post.category}
          </span>
        )}
        {post.evergreen && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title={`Recycles every ${post.recycleEveryDays} days${post.timesRecycled ? ` · recycled ${post.timesRecycled}×` : ""}`} style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
            <Recycle className="w-2.5 h-2.5" /> evergreen
          </span>
        )}
        {post.recycledFrom && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title="Automatically recycled from an evergreen post" style={{ background: "var(--panel)", color: "var(--mute)" }}>
            <Recycle className="w-2.5 h-2.5" /> recycled
          </span>
        )}
        {when && (
          <span className="font-mono text-[11px] text-[var(--mute)]">
            {post.scheduledAt ? "for " : "at "}
            {when.toLocaleString("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <span className="flex-1" />
        {/* Approval decisions — admin only, on held posts. */}
        {post.approval === "pending" && isAdmin && (
          <>
            <form action={approveSocialPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button className="btn sm primary" title={post.scheduledAt ? "Approve — it keeps its requested time" : "Approve — it becomes a normal draft"}>
                <Check className="w-3.5 h-3.5" /> Approve
              </button>
            </form>
            <form action={requestChangesSocialPostAction} className="inline-flex items-center gap-1">
              <input type="hidden" name="id" value={post.id} />
              <input name="note" placeholder="What needs to change?" maxLength={500} className="text-xs w-44 border border-[var(--line-2)] rounded-lg px-1.5 py-1" />
              <button className="btn sm" title="Send it back with a note"><X className="w-3.5 h-3.5" /> Request changes</button>
            </form>
          </>
        )}
        {/* A pre-workflow draft enters review here. */}
        {approvalOn && !isAdmin && post.approval === null && (post.status === "draft" || post.status === "scheduled") && (
          <form action={submitForApprovalAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Send to an admin for approval"><ShieldCheck className="w-3.5 h-3.5" /> Submit for approval</button>
          </form>
        )}
        {/* Queue = the schedule picks the time. Always available without a
            drag, which is what keeps calendar DnD an enhancement. */}
        {unsent && canQueue && !(approvalOn && !isAdmin && post.approval === null) && (
          <form action={queueSocialPostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Move to the next free slot on the posting schedule">
              <ListPlus className="w-3.5 h-3.5" /> Queue
            </button>
          </form>
        )}
        {unsent && !(approvalOn && !isAdmin) && (
          <form action={publishNowAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Publish immediately"><Send className="w-3.5 h-3.5" /> Post now</button>
          </form>
        )}
        {canRetry && (
          <form action={publishNowAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Retry the legs that failed"><RotateCw className="w-3.5 h-3.5" /> Retry</button>
          </form>
        )}
        {post.status === "scheduled" && (
          <form action={cancelScheduledAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Move to drafts">Cancel</button>
          </form>
        )}
        {/* Held posts stay EDITABLE — editing is how changes-requested gets
            answered; it resubmits automatically. Only sending is locked. */}
        {(post.status === "draft" || post.status === "scheduled") && (
          <Link href={`/social/${post.id}/edit`} className="btn sm" title={held ? "Edit and resubmit for approval" : "Edit text, targets, schedule"}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
        )}
        <form action={duplicateSocialPostAction}>
          <input type="hidden" name="id" value={post.id} />
          <button className="btn sm" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
        </form>
        <form action={deleteSocialPostAction}>
          <input type="hidden" name="id" value={post.id} />
          <button className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </form>
      </div>
      <p className="text-sm text-[var(--slate)] whitespace-pre-wrap mb-1">{post.text || <span className="text-[var(--mute)] italic">(image only)</span>}</p>
      {post.approval === "changes" && post.reviewNote && (
        <p className="text-xs rounded-lg px-2 py-1.5 mb-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          Reviewer: {post.reviewNote}
        </p>
      )}
      {listKeys(post.mediaKeys).length > 0 && (
        <div className="mb-2">
          <MediaThumbs keys={listKeys(post.mediaKeys)} />
        </div>
      )}
      {/* Per-network overrides — customized text and/or images. */}
      {post.targets.some((t) => t.text || t.mediaKeys) && (
        <div className="flex flex-col gap-1 mb-2">
          {post.targets.filter((t) => t.text || t.mediaKeys).map((t) => {
            const net = networkFor(t.provider);
            const imgs = listKeys(t.mediaKeys);
            return (
              <div key={t.id} className="text-xs text-[var(--slate)] border-l-2 pl-2" style={{ borderColor: net?.color ?? "var(--line-2)" }}>
                <span className="font-mono text-[10px] uppercase tracking-wider mr-1" style={{ color: net?.color ?? "var(--mute)" }}>{net?.label ?? t.provider}</span>
                {t.text ? <span className="whitespace-pre-wrap">{t.text}</span> : <span className="text-[var(--mute)] italic">base text</span>}
                {imgs.length > 0 && (
                  <div className="mt-1">
                    <MediaThumbs keys={imgs} size="h-10 w-10" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {post.targets.map((t) => {
          const net = networkFor(t.provider);
          const posted = t.status === "posted";
          const failed = t.status === "failed";
          return (
            <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: net?.color ?? "var(--line-2)" }}
              title={t.error ?? undefined}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
              {net?.label ?? t.provider}
              {(t.text || t.mediaKeys) && <Pencil className="w-2.5 h-2.5" style={{ color: "var(--mute)" }} />}
              {posted && <Check className="w-3 h-3" style={{ color: "var(--green-on)" }} />}
              {failed && <X className="w-3 h-3" style={{ color: "var(--rose-on)" }} />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Section({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-6">
      {icon}
      <h2 className="font-mono font-bold text-sm">{title}</h2>
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>{count}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="card text-xs text-[var(--mute)] mb-2">{text}</div>;
}

export function Banner({ kind, text }: { kind: "ok" | "err"; text: string }) {
  const ok = kind === "ok";
  return (
    <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", borderColor: ok ? "var(--green)" : "var(--rose)" }}>
      {ok ? <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> : <X className="w-4 h-4" style={{ color: "var(--rose-on)" }} />}
      {text}
    </div>
  );
}

/** The page heading every Social tab shares. */
export function SocialHeader({
  icon, title, blurb, children,
}: { icon: React.ReactNode; title: string; blurb: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="w-12 h-12 rounded-2xl grid place-items-center flex-shrink-0" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <h1 className="font-mono font-bold text-2xl leading-tight">{title}</h1>
        <p className="text-xs text-[var(--mute)]">{blurb}</p>
      </div>
      {children}
    </div>
  );
}
