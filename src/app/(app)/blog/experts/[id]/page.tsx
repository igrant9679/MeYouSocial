import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteSmeProfileAction,
  resolvePendingAnswerAction,
  restoreSmeVersionAction,
  saveSmeProfileAction,
  seedSmeFromSourceAction,
  setSmeKindAction,
  setSmeStatusAction,
} from "@/app/actions/sme";
import { INTAKE_QUESTIONS, completeness, parseAnswers, parseTopics } from "@/lib/sme";
import { AiAssist } from "@/components/AiAssist";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";

// FR-3 — the structured intake. One pass per expert replaces the per-article
// interview; every save keeps the prior version.

export default async function SmeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const profile = await db.smeProfile.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { versions: { orderBy: { version: "desc" }, take: 8 }, topicLinks: { select: { id: true } } },
  });
  if (!profile) notFound();
  // E-IDE-14: the Topics an expert can speak on, what waits for them, and the drafts that spoke as them.
  const linked = new Set(profile.topicLinks.map((t) => t.id));
  const [allTopics, spoke] = await Promise.all([
    db.topic.findMany({ where: { workspaceId: workspace.id, OR: [{ status: "active" }, { id: { in: [...linked] } }] }, orderBy: [{ priority: "desc" }, { name: "asc" }], select: { id: true, name: true, status: true } }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, smeProfileId: profile.id }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true, status: true, updatedAt: true } }),
  ]);
  const persona = profile.kind === "persona";
  const pending = parseAnswers(profile.pendingAnswers);

  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const answers = parseAnswers(profile.answers);
  const done = completeness(answers);
  const topics = parseTopics(profile.topics);

  return (
    <main className="p-6 w-full">
      <Link href="/blog/experts" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Experts
      </Link>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight flex items-center gap-2 flex-wrap">
            {profile.name}
            <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full" data-kind={profile.kind} style={persona ? { background: "var(--indigo-soft)", color: "var(--indigo-on)" } : { background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
              {persona ? "audience persona" : "expert"}
            </span>
          </h1>
          <p className="text-xs text-[var(--mute)]">
            {persona
              ? "Who the content is for — a persona never speaks in a draft."
              : `${done.answered}/${done.total} questions answered · v${profile.version}`}
            {profile.status === "archived" ? " · archived" : ""}
          </p>
        </div>
        {editor && (
          <form action={setSmeKindAction}>
            <input type="hidden" name="id" value={profile.id} />
            <input type="hidden" name="kind" value={persona ? "expert" : "persona"} />
            <SubmitButton className="btn" title={persona ? "A real person whose knowledge drafts can speak in" : "A role or audience the content is written for — it stops speaking in drafts"}>
              {persona ? "This is a real person" : "This is an audience persona"}
            </SubmitButton>
          </form>
        )}
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
        {!persona && (
          <fieldset className="text-sm" data-expert-topics>
            <legend className="block text-xs text-[var(--mute)] mb-1">
              Topics they speak on — a draft on one of these speaks as them. None ticked: they speak on every Topic while they are the only expert.
            </legend>
            {allTopics.length === 0 ? (
              <p className="text-xs text-[var(--mute)] m-0">No Topics yet — add them under Ideas → Topics.</p>
            ) : (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {allTopics.map((t) => (
                  <label key={t.id} className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" name="topicId" value={t.id} defaultChecked={linked.has(t.id)} disabled={!editor} />
                    {t.name}{t.status !== "active" ? " (archived)" : ""}
                  </label>
                ))}
              </div>
            )}
            {topics.length > 0 && (
              <p className="text-[11px] text-[var(--mute)] mt-1 mb-0" data-old-topic-words>
                The words this profile used to be matched by — no longer used: {topics.join(", ")}.
              </p>
            )}
          </fieldset>
        )}
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Credentials</span>
          <input name="credentials" defaultValue={profile.credentials ?? ""} placeholder="only ones that genuinely exist — drafts may cite these" className="w-full text-xs" disabled={!editor} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Short background</span>
          <textarea name="bio" defaultValue={profile.bio ?? ""} rows={2} className="w-full text-xs" disabled={!editor} />
        </label>
        {/* ⚠ The bio gets a draft button; the INTERVIEW ANSWERS below deliberately
            do not. A bio restates facts already on this record, but the answers
            are the expert's own words — drafting them would put invented opinions
            and experience in a named person's mouth, which is the one thing this
            whole profile exists to prevent. */}
        {editor && <AiAssist field="persona.bio" target="bio" siblings={{ name: "Name", role: "Role" }} />}

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

      {/* E-IDE-14: drafted answers wait for the expert. */}
      {Object.keys(pending).length > 0 && (
        <section className="card mt-5 flex flex-col gap-3" data-pending-answers>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold m-0">Waiting for {profile.name}</h2>
            <span className="text-xs text-[var(--mute)] flex-1">Drafted from a source — not their words until they accept them. Drafts don&apos;t use these.</span>
            {editor && (
              <>
                <form action={resolvePendingAnswerAction}>
                  <input type="hidden" name="id" value={profile.id} />
                  <input type="hidden" name="q" value="*" />
                  <input type="hidden" name="verdict" value="accept" />
                  <SubmitButton className="btn sm" pendingText="…">Accept all as drafted</SubmitButton>
                </form>
                <form action={resolvePendingAnswerAction}>
                  <input type="hidden" name="id" value={profile.id} />
                  <input type="hidden" name="q" value="*" />
                  <input type="hidden" name="verdict" value="discard" />
                  <SubmitButton className="btn sm" pendingText="…">Discard all</SubmitButton>
                </form>
              </>
            )}
          </div>
          {INTAKE_QUESTIONS.filter((q) => pending[q.id]).map((q) => (
            <form key={q.id} action={resolvePendingAnswerAction} className="flex flex-col gap-1.5 border-t border-[var(--line)] pt-2" data-pending={q.id}>
              <input type="hidden" name="id" value={profile.id} />
              <input type="hidden" name="q" value={q.id} />
              <span className="text-xs font-semibold">{q.question}</span>
              <textarea name="text" defaultValue={pending[q.id]} rows={3} className="w-full text-xs" disabled={!editor} />
              {editor && (
                <div className="flex gap-1.5">
                  <SubmitButton className="btn sm primary" name="verdict" value="accept" pendingText="…">Accept as written above</SubmitButton>
                  <SubmitButton className="btn sm" name="verdict" value="discard" pendingText="…">Discard</SubmitButton>
                </div>
              )}
            </form>
          ))}
        </section>
      )}

      {!persona && (
        <section className="card mt-5" data-expert-drafts>
          <h2 className="text-sm font-semibold mb-1">Drafts that speak as {profile.name}</h2>
          {spoke.length === 0 ? (
            <p className="text-xs text-[var(--mute)] m-0">None yet — a draft records its expert when it is written.</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs">
              {spoke.map((b) => (
                <li key={b.id} className="flex items-center gap-2 border-b border-[var(--line)] pb-1 last:border-0" data-expert-draft={b.id}>
                  <Link href={`/blog/${b.id}`} className="flex-1 min-w-0 truncate underline">{b.title}</Link>
                  <span className="font-mono text-[10px] text-[var(--mute)]">{b.status.replace(/_/g, " ")} · {formatZonedMoment(b.updatedAt, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Seed from existing material (FR-3) */}
      {editor && (
        <form action={seedSmeFromSourceAction} className="card mt-5 flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Seed from existing material</h2>
          <p className="text-xs text-[var(--mute)]">
            Pull draft answers out of a services page, portfolio, or prior article. They wait above for {profile.name} to
            accept or correct — never their words until then, and never used in a draft. Only unanswered questions are
            drafted, and extraction can only surface what the source actually says.
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
                  {formatZonedMoment(v.createdAt, tz)}
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
