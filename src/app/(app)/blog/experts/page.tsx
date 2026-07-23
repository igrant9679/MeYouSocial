import Link from "next/link";
import { ArrowLeft, Plus, UserRoundCheck } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { createSmeProfileAction } from "@/app/actions/sme";
import { completeness, parseAnswers, parseTopics } from "@/lib/sme";

// FR-3 — the expert roster. Each profile is captured once and replayed into
// every draft that matches its topics.

export default async function SmeListPage() {
  const { workspace, membership } = await requireMembership();
  const profiles = await db.smeProfile.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const editor = canEdit(membership.role);

  return (
    <main className="p-6 max-w-3xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
          <UserRoundCheck className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Experts</h1>
          <p className="text-xs text-[var(--mute)]">
            Capture each expert&apos;s knowledge once; drafts on their topics then answer as they would.
          </p>
        </div>
      </div>

      {editor && (
        <form action={createSmeProfileAction} className="card mb-5 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-40 text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Name</span>
            <input name="name" required placeholder="e.g. Idris Grant" className="w-full" />
          </label>
          <label className="text-sm w-48">
            <span className="block text-xs text-[var(--mute)] mb-1">Role</span>
            <input name="role" placeholder="Accessibility lead" className="w-full" />
          </label>
          <SubmitButton className="btn primary"><Plus className="w-4 h-4" /> Add expert</SubmitButton>
        </form>
      )}

      {profiles.length === 0 ? (
        <div className="card">
          <p className="text-xs text-[var(--mute)]">
            No experts yet. Without one, drafts are grounded only in the organization profile — competent, but not
            anyone in particular.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {profiles.map((p) => {
            const done = completeness(parseAnswers(p.answers));
            const topics = parseTopics(p.topics);
            const hue = done.answered === done.total ? "green" : done.answered > 0 ? "amber" : "rose";
            return (
              <li key={p.id} className="card flex flex-wrap items-center gap-2">
                <Link href={`/blog/experts/${p.id}`} className="font-semibold text-sm underline">
                  {p.name}
                </Link>
                {p.role && <span className="text-xs text-[var(--mute)]">{p.role}</span>}
                {p.status === "archived" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                    archived
                  </span>
                )}
                <span className="flex-1" />
                {topics.length > 0 && (
                  <span className="text-[11px] text-[var(--mute)] truncate max-w-56">{topics.join(" · ")}</span>
                )}
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                >
                  {done.answered}/{done.total} answered
                </span>
                <span className="font-mono text-[10px] text-[var(--mute)]">v{p.version}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
