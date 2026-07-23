import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// Content Calendar: month view of content by publish date, colored by status.

const STATUS_COLOR: Record<string, string> = {
  idea: "#D97706",
  research_writing: "#2563EB",
  recording: "#6D28D9",
  editing: "#4F46E5",
  scheduled: "#0D9488",
  published: "#15924B",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const { workspace } = await requireMembership();
  const sp = await searchParams;
  const now = new Date();
  const y = sp.y ? Number(sp.y) : now.getFullYear();
  const m = sp.m ? Number(sp.m) : now.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);

  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59);
  const [projects, blogPosts] = await Promise.all([
    db.contentProject.findMany({
      where: {
        channel: { workspaceId: workspace.id },
        publishDate: { gte: first, lte: monthEnd },
      },
      include: { channel: { select: { name: true, accentColor: true } } },
      orderBy: { publishDate: "asc" },
    }),
    // Unified view: scheduled blog publishes land on the same grid.
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, scheduledAt: { gte: first, lte: monthEnd } },
      select: { id: true, title: true, scheduledAt: true, status: true },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);

  // Build day grid (Sunday-start)
  const startWeekday = first.getDay(); // 0 = Sun
  const daysInMonth = last.getDate();
  const cells: Array<{ date: Date | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(y, m, d) });
  while (cells.length % 7 !== 0) cells.push({ date: null });

  const projectsForDay = (date: Date) => projects.filter((p) => p.publishDate && new Date(p.publishDate).toDateString() === date.toDateString());
  const postsForDay = (date: Date) => blogPosts.filter((p) => p.scheduledAt && new Date(p.scheduledAt).toDateString() === date.toDateString());

  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  const nextY = m === 11 ? y + 1 : y;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><Calendar className="w-5 h-5" style={{ color: "#15924B" }} /> {first.toLocaleString(undefined, { month: "long", year: "numeric" })}</h2>
        <span className="flex-1" />
        <Link href={`/production/calendar?y=${prevY}&m=${prevM}`} className="btn sm"><ChevronLeft className="w-4 h-4" /></Link>
        <Link href="/production/calendar" className="btn sm">Today</Link>
        <Link href={`/production/calendar?y=${nextY}&m=${nextM}`} className="btn sm"><ChevronRight className="w-4 h-4" /></Link>
      </div>

      <div className="card">
        <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            const isToday = cell.date && cell.date.toDateString() === new Date().toDateString();
            const items = cell.date ? projectsForDay(cell.date) : [];
            return (
              <div
                key={i}
                className="aspect-[5/4] border border-[var(--line)] rounded-lg p-1.5 flex flex-col gap-1 overflow-hidden"
                style={{ background: cell.date ? (isToday ? "var(--accent-soft)" : "white") : "var(--zebra)" }}
              >
                {cell.date && <div className={"text-[11px] font-mono " + (isToday ? "font-bold text-[var(--accent)]" : "text-[var(--mute)]")}>{cell.date.getDate()}</div>}
                {items.map((p) => (
                  <Link key={p.id} href={`/production?focus=${p.id}`} className="block text-[10px] font-mono px-1.5 py-0.5 rounded truncate hover:opacity-80" style={{ background: (STATUS_COLOR[p.status] ?? "var(--accent)") + "20", color: STATUS_COLOR[p.status] ?? "var(--accent)" }}>
                    {p.title}
                  </Link>
                ))}
                {cell.date && postsForDay(cell.date).map((p) => (
                  <Link key={p.id} href={`/blog/${p.id}`} className="block text-[10px] font-mono px-1.5 py-0.5 rounded truncate hover:opacity-80" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                    ✍ {p.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] font-mono text-[var(--mute)]">
        {Object.entries(STATUS_COLOR).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{s.replace("_", " ")}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--rose)" }} />✍ blog publish (scheduled)</span>
      </div>
    </div>
  );
}
