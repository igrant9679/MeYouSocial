import Link from "next/link";
import { Share2, CalendarClock, Send, Copy, Trash2, RotateCw, Check, X, Clock, Pencil, Image as ImageIcon, Tags } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { SocialComposer } from "@/components/SocialComposer";
import { networkFor } from "@/lib/social/networks";
import {
  publishNowAction,
  cancelScheduledAction,
  deleteSocialPostAction,
  duplicateSocialPostAction,
} from "@/app/actions/social";

// Social scheduler — compose once, fan out to connected accounts, post now or
// schedule. Publishing runs through Unipile; the scheduler sweep sends due posts.

type SP = { ok?: string; err?: string };

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  scheduled: { bg: "var(--blue-soft)", fg: "var(--blue-on)", label: "scheduled" },
  publishing: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "publishing" },
  posted: { bg: "var(--green-soft)", fg: "var(--green-on)", label: "posted" },
  partial: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "partly posted" },
  failed: { bg: "var(--rose-soft)", fg: "var(--rose-on)", label: "failed" },
  draft: { bg: "var(--panel)", fg: "var(--mute)", label: "draft" },
};

export default async function SocialPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;

  const [accounts, posts, topicRows] = await Promise.all([
    db.unipileAccount.findMany({
      where: { workspaceId: workspace.id, kind: "social", status: "connected" },
      orderBy: { createdAt: "asc" },
      select: { id: true, provider: true, name: true },
    }),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: { targets: true, topic: { select: { name: true } } },
      take: 100,
    }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, keywords: true },
    }),
  ]);
  const topics = topicRows.map((t) => ({ id: t.id, name: t.name, keywords: readJson<string[]>(t.keywords, []) }));

  const scheduled = posts
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  const drafts = posts.filter((p) => p.status === "draft");
  const history = posts.filter((p) => ["posted", "partial", "failed", "publishing"].includes(p.status));

  // Group scheduled by day for the agenda/calendar.
  const byDay = new Map<string, typeof scheduled>();
  for (const p of scheduled) {
    const day = p.scheduledAt!.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" });
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(p);
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Share2 className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Social scheduler</h1>
          <p className="text-xs text-[var(--mute)]">Compose once, publish to your connected profiles now or on a schedule.</p>
        </div>
        <Link href="/admin/connections" className="btn sm">Manage accounts</Link>
      </div>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <SocialComposer accounts={accounts} topics={topics} />

      {/* Scheduled — agenda grouped by day */}
      <Section icon={<CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Scheduled" count={scheduled.length} />
      {scheduled.length === 0 ? (
        <Empty text="Nothing scheduled. Use the composer above and pick “Schedule”." />
      ) : (
        [...byDay.entries()].map(([day, items]) => (
          <div key={day} className="mb-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--mute)] mb-2">{day}</div>
            <div className="flex flex-col gap-2">
              {items.map((p) => <PostCard key={p.id} post={p} />)}
            </div>
          </div>
        ))
      )}

      {drafts.length > 0 && (
        <>
          <Section icon={<Clock className="w-4 h-4" style={{ color: "var(--mute)" }} />} title="Drafts" count={drafts.length} />
          <div className="flex flex-col gap-2 mb-6">{drafts.map((p) => <PostCard key={p.id} post={p} />)}</div>
        </>
      )}

      <Section icon={<Send className="w-4 h-4" style={{ color: "var(--green-on)" }} />} title="History" count={history.length} />
      {history.length === 0 ? (
        <Empty text="Posts you publish appear here with per-network status." />
      ) : (
        <div className="flex flex-col gap-2">{history.map((p) => <PostCard key={p.id} post={p} />)}</div>
      )}
    </div>
  );
}

type PostRow = {
  id: string;
  text: string;
  mediaKeys: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  topic: { name: string } | null;
  targets: { id: string; provider: string; accountName: string | null; text: string | null; mediaKeys: string | null; status: string; error: string | null }[];
};

/** How many images a JSON key array holds (0 for null/malformed). */
function countKeys(raw: string | null): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function PostCard({ post }: { post: PostRow }) {
  const s = STATUS_STYLE[post.status] ?? STATUS_STYLE.draft;
  const when = post.scheduledAt ?? post.publishedAt;
  const canRetry = post.status === "failed" || post.status === "partial";
  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
        {post.topic && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
            <Tags className="w-2.5 h-2.5" /> {post.topic.name}
          </span>
        )}
        {when && (
          <span className="font-mono text-[11px] text-[var(--mute)]">
            {post.scheduledAt ? "for " : "at "}{when.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <span className="flex-1" />
        {(post.status === "draft" || post.status === "scheduled") && (
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
      {countKeys(post.mediaKeys) > 0 && (
        <p className="font-mono text-[10px] text-[var(--mute)] mb-2 inline-flex items-center gap-1">
          <ImageIcon className="w-3 h-3" /> {countKeys(post.mediaKeys)} base image{countKeys(post.mediaKeys) > 1 ? "s" : ""}
        </p>
      )}
      {/* Per-network overrides — customized text and/or images. */}
      {post.targets.some((t) => t.text || t.mediaKeys) && (
        <div className="flex flex-col gap-1 mb-2">
          {post.targets.filter((t) => t.text || t.mediaKeys).map((t) => {
            const net = networkFor(t.provider);
            const imgs = countKeys(t.mediaKeys);
            return (
              <div key={t.id} className="text-xs text-[var(--slate)] border-l-2 pl-2" style={{ borderColor: net?.color ?? "var(--line-2)" }}>
                <span className="font-mono text-[10px] uppercase tracking-wider mr-1" style={{ color: net?.color ?? "var(--mute)" }}>{net?.label ?? t.provider}</span>
                {t.text ? <span className="whitespace-pre-wrap">{t.text}</span> : <span className="text-[var(--mute)] italic">base text</span>}
                {imgs > 0 && (
                  <span className="font-mono text-[10px] text-[var(--mute)] ml-1.5 inline-flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> {imgs} own image{imgs > 1 ? "s" : ""}
                  </span>
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

function Section({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-6">
      {icon}
      <h2 className="font-mono font-bold text-sm">{title}</h2>
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>{count}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="card text-xs text-[var(--mute)] mb-2">{text}</div>;
}

function Banner({ kind, text }: { kind: "ok" | "err"; text: string }) {
  const ok = kind === "ok";
  return (
    <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", borderColor: ok ? "var(--green)" : "var(--rose)" }}>
      {ok ? <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> : <X className="w-4 h-4" style={{ color: "var(--rose-on)" }} />}
      {text}
    </div>
  );
}
