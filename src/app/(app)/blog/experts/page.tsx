import Link from "next/link";
import { ArrowLeft, Plus, UserRoundCheck, Users } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { createSmeProfileAction } from "@/app/actions/sme";
import { completeness, parseAnswers } from "@/lib/sme";
import { EmptyState } from "@/components/EmptyState";

// FR-3 — the expert roster. E-IDE-14: experts are real people a draft speaks
// as, linked to the Topics they speak on; audience personas are who the
// content is FOR and never speak. Each expert shows what still waits for them.

export default async function SmeListPage() {
  const { workspace, membership } = await requireMembership();
  const profiles = await db.smeProfile.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { topicLinks: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  const drafts = new Map(
    (await db.blogPost.groupBy({ by: ["smeProfileId"], where: { workspaceId: workspace.id, smeProfileId: { in: profiles.map((p) => p.id) } }, _count: { _all: true } }))
      .map((g) => [g.smeProfileId!, g._count._all]),
  );
  const editor = canEdit(membership.role);
  const experts = profiles.filter((p) => p.kind !== "persona");
  const personas = profiles.filter((p) => p.kind === "persona");

  return (
    <main className="p-6 w-full">
      <Link href="/ideas" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Ideas
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
          <UserRoundCheck className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Experts</h1>
          <p className="text-xs text-[var(--mute)]">
            Real people whose knowledge drafts speak in — each linked to the Topics they speak on. Audience personas, the people the content is for, are kept apart and never speak.
          </p>
        </div>
      </div>

      {editor && (
        <form id="add-expert" action={createSmeProfileAction} className="card mb-5 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-40 text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Name</span>
            <input name="name" required placeholder="e.g. Idris Grant" className="w-full" />
          </label>
          <label className="text-sm w-48">
            <span className="block text-xs text-[var(--mute)] mb-1">Role</span>
            <input name="role" placeholder="Accessibility lead" className="w-full" />
          </label>
          <label className="text-sm w-56">
            <span className="block text-xs text-[var(--mute)] mb-1">This is</span>
            <select name="kind" defaultValue="expert" className="w-full">
              <option value="expert">a real person — drafts speak as them</option>
              <option value="persona">an audience persona — content is for them</option>
            </select>
          </label>
          <SubmitButton className="btn primary"><Plus className="w-4 h-4" /> Add</SubmitButton>
        </form>
      )}

      {experts.length === 0 ? (
        <EmptyState
          line="No experts yet."
          note="Without one, drafts are grounded only in the organization profile — competent, but not anyone in particular. Answers you give in the Inbox bank here automatically."
          action={editor ? { label: "Add an expert", href: "#add-expert" } : null}
        />
      ) : (
        <ul className="flex flex-col gap-2 mb-6" data-experts>
          {experts.map((p) => {
            const done = completeness(parseAnswers(p.answers));
            const waiting = Object.keys(parseAnswers(p.pendingAnswers)).length;
            const hue = done.answered === done.total ? "green" : done.answered > 0 ? "amber" : "rose";
            const n = drafts.get(p.id) ?? 0;
            return (
              <li key={p.id} className="card flex flex-wrap items-center gap-2" data-expert={p.id}>
                <Link href={`/blog/experts/${p.id}`} className="font-semibold text-sm underline">{p.name}</Link>
                {p.role && <span className="text-xs text-[var(--mute)]">{p.role}</span>}
                {p.status === "archived" && (
                  <span className="font-mono text-micro px-2 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>archived</span>
                )}
                <span className="flex-1" />
                <span className="text-2xs text-[var(--mute)] truncate max-w-72" data-expert-topics>
                  {p.topicLinks.length ? p.topicLinks.map((t) => t.name).join(" · ") : "every Topic (when the only expert)"}
                </span>
                {n > 0 && <span className="font-mono text-micro text-[var(--mute)]">{n} draft{n === 1 ? "" : "s"}</span>}
                {waiting > 0 && (
                  <span className="font-mono text-micro px-2 py-0.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }} title="Drafted from a source — waiting for the expert to accept">{waiting} waiting</span>
                )}
                <span className="font-mono text-micro px-2 py-0.5 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
                  {done.answered}/{done.total} answered
                </span>
                <span className="font-mono text-micro text-[var(--mute)]">v{p.version}</span>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2"><Users className="w-4 h-4" style={{ color: "var(--indigo-on)" }} /> Audience personas</h2>
      {personas.length === 0 ? (
        <p className="text-xs text-[var(--mute)]">None. A persona describes who the content is for — a role like “Compliance officer” — and never speaks in a draft. If a profile above is really a role rather than a person, open it and mark it as a persona.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-personas>
          {personas.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center gap-2" data-persona={p.id}>
              <Link href={`/blog/experts/${p.id}`} className="font-semibold text-sm underline">{p.name}</Link>
              {p.role && <span className="text-xs text-[var(--mute)]">{p.role}</span>}
              {p.status === "archived" && <span className="font-mono text-micro text-[var(--mute)]">archived</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
