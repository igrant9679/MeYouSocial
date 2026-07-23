import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// Publishing calendar (Spark port): posts grouped by month of publishedAt
// (or updatedAt for in-flight work), newest month first.

export default async function BlogCalendarPage() {
  const { workspace } = await requireMembership();
  const posts = await db.blogPost.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { updatedAt: "desc" },
  });

  const byMonth = new Map<string, typeof posts>();
  for (const p of posts) {
    const d = p.publishedAt ?? p.updatedAt;
    const key = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    byMonth.set(key, [...(byMonth.get(key) ?? []), p]);
  }

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
          <CalendarDays className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Publishing calendar</h1>
          <p className="text-xs text-[var(--mute)]">Published posts by month; in-flight work under its last-touched month.</p>
        </div>
      </div>

      {byMonth.size === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)]">Nothing yet — the calendar fills as posts are created and published.</p>
        </div>
      ) : (
        [...byMonth.entries()].map(([month, list]) => (
          <section key={month} className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--mute)] mb-1.5">{month}</h2>
            <ul className="card flex flex-col divide-y divide-[var(--line)]">
              {list.map((p) => (
                <li key={p.id} className="py-1.5 first:pt-0 last:pb-0 flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-[var(--mute)] w-8 shrink-0">
                    {(p.publishedAt ?? p.updatedAt).toLocaleDateString("en-GB", { day: "2-digit" })}
                  </span>
                  <Link href={`/blog/${p.id}`} className="underline truncate flex-1">{p.title}</Link>
                  <span
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={
                      p.status === "published"
                        ? { background: "var(--green-soft)", color: "var(--green-on)" }
                        : { background: "var(--panel)", color: "var(--mute)" }
                    }
                  >
                    {p.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
