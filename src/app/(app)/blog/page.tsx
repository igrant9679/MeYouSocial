import Link from "next/link";
import { CalendarDays, FileText, Plus, Sparkles } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { createBlogPostAction } from "@/app/actions/blog";
import { discoverBlogIdeasAction } from "@/app/actions/blog-ideas";
import { motifSummaryLabel, parseMotifs } from "@/lib/motifs";

// Blog home — the full-width workspace. Pipeline as a kanban board (cards link
// into the tabbed editor), a week-ahead calendar ribbon, quick create. The
// sub-nav above (layout.tsx) replaces the old button row.

const COLUMNS = [
  { status: "drafting", title: "Drafting", hue: "amber" },
  { status: "draft_review", title: "In review", hue: "blue" },
  { status: "final_approval", title: "Final approval", hue: "violet" },
  { status: "published", title: "Published", hue: "green" },
] as const;

export default async function BlogPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [posts, topIdeas, scheduled, renders] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: "desc" },
      include: {
        citations: { where: { verified: false }, select: { id: true } },
        images: { select: { role: true, status: true } },
        comments: { where: { resolved: false }, select: { id: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { position: true, clicks: true } },
      },
    }),
    db.blogIdea.findMany({
      where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, scheduledAt: { gte: now, lte: weekEnd } },
      select: { id: true, title: true, scheduledAt: true },
    }),
    db.videoRender.findMany({
      where: { workspaceId: workspace.id, status: { in: ["queued", "rendering"] } },
      select: { id: true, title: true, createdAt: true },
      take: 6,
    }),
  ]);

  // Week ribbon: next 7 days with scheduled publishes + active renders.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setDate(dEnd.getDate() + 1);
    return {
      date: d,
      publishes: scheduled.filter((s) => s.scheduledAt && s.scheduledAt >= d && s.scheduledAt < dEnd),
      renders: i === 0 ? renders : [],
    };
  });

  const published = posts.filter((p) => p.status === "published");

  return (
    <main className="p-6 w-full">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          <FileText className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Posts</h1>
          <p className="text-xs text-[var(--mute)]">Idea → grounded draft → gates → publish. Cards open the editor.</p>
        </div>
        {editor && (
          <form action={createBlogPostAction} className="flex items-end gap-2">
            <label className="text-sm">
              <span className="sr-only">New post title</span>
              <input name="title" required placeholder="New post title…" className="w-56" />
            </label>
            <SubmitButton className="btn primary"><Plus className="w-4 h-4" /> Create</SubmitButton>
          </form>
        )}
      </div>

      {/* Kanban — full width */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        {COLUMNS.map((col) => {
          const items = posts.filter((p) => p.status === col.status);
          const shown = col.status === "published" ? items.slice(0, 6) : items;
          return (
            <section key={col.status} className="min-w-0">
              <h2
                className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider mb-2 px-1"
                style={{ color: `var(--${col.hue}-on)` }}
              >
                {col.title} <span>{items.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {shown.length === 0 && (
                  <div className="card text-center text-xs text-[var(--mute)] py-5">Empty</div>
                )}
                {shown.map((p) => {
                  const missingImages =
                    !p.images.some((i) => i.role === "featured" && i.status === "approved") ||
                    !p.images.some((i) => i.role === "og" && i.status === "approved");
                  const motifs = parseMotifs(p.motifs);
                  const snap = p.snapshots[0];
                  return (
                    <Link
                      key={p.id}
                      href={`/blog/${p.id}`}
                      className="card lift block !p-3"
                    >
                      <div className="text-[13px] font-semibold leading-snug mb-1.5">{p.title}</div>
                      <div className="flex flex-wrap gap-1">
                        {motifs.length > 0 && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
                            {motifSummaryLabel(motifs).split(" + ")[0]}
                          </span>
                        )}
                        {p.citations.length > 0 && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                            {p.citations.length} citation{p.citations.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {p.status !== "published" && p.status !== "drafting" && missingImages && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                            images
                          </span>
                        )}
                        {p.comments.length > 0 && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
                            {p.comments.length} note{p.comments.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {p.status === "published" && snap?.position != null && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                            pos {snap.position.toFixed(1)}{snap.clicks != null ? ` · ${snap.clicks}c` : ""}
                          </span>
                        )}
                        {p.scheduledAt && p.status === "final_approval" && (
                          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
                            {p.scheduledAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {col.status === "published" && items.length > shown.length && (
                  <Link href="/blog/board" className="text-[11px] text-[var(--mute)] underline px-1">
                    + {items.length - shown.length} more on the board
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Week ribbon */}
      <section className="card mb-4">
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-4 h-4" style={{ color: "var(--cyan-on)" }} />
          <h2 className="font-mono text-[13px] font-bold flex-1">This week</h2>
          <Link href="/blog/calendar" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">full calendar →</Link>
        </div>
        {/* 7 columns are unreadable on phones — below ~42rem effective width
            the week becomes a horizontal scroll track instead of 50px slivers. */}
        <div className="grid grid-flow-col auto-cols-[minmax(92px,1fr)] overflow-x-auto @2xl:grid-flow-row @2xl:auto-cols-auto @2xl:grid-cols-7 @2xl:overflow-visible gap-1.5 pb-1 @2xl:pb-0">
          {days.map((d, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-1.5 min-h-[54px]" style={i === 0 ? { background: "var(--zebra)" } : undefined}>
              <div className="font-mono text-[9px] text-[var(--mute)] font-bold mb-1">
                {d.date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" }).toUpperCase()}
              </div>
              {d.publishes.map((p) => (
                <Link key={p.id} href={`/blog/${p.id}`} className="block rounded px-1 py-0.5 mb-0.5 text-[9px] font-bold truncate" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                  {p.title}
                </Link>
              ))}
              {d.renders.map((r) => (
                <Link key={r.id} href="/videos" className="block rounded px-1 py-0.5 mb-0.5 text-[9px] font-bold truncate" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
                  🎬 {r.title}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Top ideas strip */}
      <section className="card">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
          <h2 className="font-mono text-[13px] font-bold flex-1">Top ideas</h2>
          {editor && (
            <form action={discoverBlogIdeasAction}>
              <SubmitButton className="btn sm" pendingText="Discovering…">Discover more</SubmitButton>
            </form>
          )}
          <Link href="/blog/ideas" className="text-xs font-mono text-[var(--accent)] font-semibold hover:underline">idea board →</Link>
        </div>
        {topIdeas.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">No open ideas — run discovery or add one on the idea board.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {topIdeas.map((i) => (
              <div key={i.id} className="rounded-lg border border-[var(--line)] p-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold leading-snug flex-1">{i.title}</span>
                  {i.priority != null && (
                    <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--panel)", color: "var(--mute)" }} title={i.priorityReason ?? undefined}>
                      {i.priority}
                    </span>
                  )}
                </div>
                {i.angle && <p className="text-[10.5px] text-[var(--mute)] mt-1 line-clamp-2">{i.angle}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {published.length === 0 && posts.length === 0 && (
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          Nothing here yet — create a post above or approve an idea and let the autopilot draft it.
        </p>
      )}
    </main>
  );
}
