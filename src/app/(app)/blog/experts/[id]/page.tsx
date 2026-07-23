import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteSmeProfileAction,
  restoreSmeVersionAction,
  saveSmeProfileAction,
  seedSmeFromSourceAction,
  setSmeStatusAction,
} from "@/app/actions/sme";
import { INTAKE_QUESTIONS, completeness, parseAnswers, parseTopics } from "@/lib/sme";

// FR-3 — the structured intake. One pass per expert replaces the per-article
// interview; every save keeps the prior version.

export default async function SmeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const profile = await db.smeProfile.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { versions: { orderBy: { version: "desc" }, take: 8 } },
  });
  if (!profile) notFound();

  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const answers = parseAnswers(profile.answers);
  const done = completeness(answers);
  const topics = parseTopics(profile.topics);

  return (
    <main className="p-6 max-w-3xl mx-auto w-full">
      <Link href="/blog/experts" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Experts
      </Link>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">{profile.name}</h1>
          <p className="text-xs text-[var(--mute)]">
            {done.answered}/{done.total} questions answered · v{profile.version}
            {profile.status === "archived" ? " · archived" : ""}
          </p>
        </div>
        {editor && (
          <form action={setSmeStatusAction}>
            <input type="hidden" name="id" value={profile.id} />
            <input type="hidden" name="status" value={profile.status === "active" ? "archived" : "active"} />
            <SubmitButton className="btn">{profile.status === "active" ? "Archive" : "Reactivate"}</SubmitButton>
          </form>
        )}
        {admin && (
          <form action={deleteSmeProfileAction}>
            <input type="hidden" name="id" value={profile.id} />
            <button className="btn" title="Delete expert"><Trash2 className="w-3.5 h-3.5" /></button>
          </form>
        )}
      </div>

      <form action={saveSmeProfileAction} className="card flex flex-col gap-4">
        <input type="hidden" name="id" value={profile.id} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Name</span>
            <input name="name" defaultValue={profile.name} required className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Role</span>
            <input name="role" defaultValue={profile.role ?? ""} className="w-full" disabled={!editor} />
          </label>
        </div>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">
            Topics they own <span className="font-mono">(comma-separated — used to match posts to this expert)</span>
          </span>
          <input name="topics" defaultValue={topics.join(", ")} placeholder="accessibility, wcag, section 508" className="w-full text-xs" disabled={!editor} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Credentials</span>
          <input name="credentials" defaultValue={profile.credentials ?? ""} placeholder="only ones that genuinely exist — drafts may cite these" className="w-full text-xs" disabled={!editor} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Short background</span>
          <textarea name="bio" defaultValue={profile.bio ?? ""} rows={2} className="w-full text-xs" disabled={!editor} />
        </label>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">The intake</h2>
          {INTAKE_QUESTIONS.map((q, i) => (
            <label key={q.id} className="text-sm">
              <span className="block text-xs mb-0.5">
                <span className="font-mono text-[var(--mute)] mr-1">{String(i + 1).padStart(2, "0")}</span>
                {q.question}
              </span>
              <span className="block text-[11px] text-[var(--mute)] mb-1">{q.hint}</span>
              <textarea
                name={`answer_${q.id}`}
                defaultValue={answers[q.id] ?? ""}
                rows={q.rows}
                className="w-full text-xs"
                disabled={!editor}
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Always say</span>
            <textarea name="alwaysSay" defaultValue={profile.alwaysSay ?? ""} rows={3} className="w-full text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">
              Never say <span className="font-mono">(enforced as a hard rule in every prompt)</span>
            </span>
            <textarea name="neverSay" defaultValue={profile.neverSay ?? ""} rows={3} className="w-full text-xs" disabled={!editor} />
          </label>
        </div>

        {editor && <div><SubmitButton className="btn primary">Save profile</SubmitButton></div>}
      </form>

      {/* Seed from existing material (FR-3) */}
      {editor && (
        <form action={seedSmeFromSourceAction} className="card mt-5 flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Seed from existing material</h2>
          <p className="text-xs text-[var(--mute)]">
            Pull draft answers out of a services page, portfolio, or prior article. Only unanswered questions are
            filled, nothing you wrote is overwritten, and extraction can only surface what the source actually says —
            treat the result as a draft to correct, not a finished profile.
          </p>
          <input type="hidden" name="id" value={profile.id} />
          <input name="sourceUrl" type="url" placeholder="https://…" className="w-full font-mono text-xs" />
          <textarea name="sourceText" rows={3} placeholder="…or paste the text here" className="w-full text-xs" />
          <div>
            <SubmitButton className="btn" pendingText="Reading…">
              <Sparkles className="w-3.5 h-3.5" /> Draft answers from source
            </SubmitButton>
          </div>
        </form>
      )}

      {profile.versions.length > 0 && (
        <div className="card mt-5">
          <h2 className="text-sm font-semibold mb-2">Version history</h2>
          <ul className="text-xs flex flex-col gap-1">
            {profile.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 border-b border-[var(--line)] pb-1 last:border-0">
                <span className="font-mono text-[10px] text-[var(--mute)]">v{v.version}</span>
                <span className="flex-1 font-mono text-[10px] text-[var(--mute)]">
                  {v.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                {editor && (
                  <form action={restoreSmeVersionAction}>
                    <input type="hidden" name="versionId" value={v.id} />
                    <button className="btn">Restore</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
