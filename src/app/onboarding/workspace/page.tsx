import Link from "next/link";
import { Building2, AlertTriangle } from "lucide-react";
import { requireUser, isPlatformOperator } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { createWorkspaceAction } from "@/app/actions/workspace-switch";
import { resendVerificationAction } from "@/app/actions/auth-flows";
import { pendingInvitationsFor } from "@/lib/invitations";
import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/zoned-dates";
import { TEMPLATE_PART_LABEL, TEMPLATE_PARTS, templateSummary } from "@/lib/workspace-template";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

/**
 * Create a workspace.
 *
 * ⚠ THIS PAGE MUST STAY OUTSIDE THE `(app)` ROUTE GROUP.
 *
 * `requireMembership()` redirects a user with no active memberships here. That
 * group's layout calls `getActiveChannel()` → `requireMembership()`, so putting
 * this page inside it would send such a user straight back to this URL, for
 * ever. The route existed as a redirect target long before it existed as a
 * page, and this loop is precisely why it has to sit on the bare root layout —
 * alongside `/invitations/[token]`, which is outside for the same reason.
 *
 * It also backs a deliberate "add another company" from Settings.
 */
export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;
  const active = user.memberships.filter((m) => m.status === "active");
  const first = active.length === 0;
  // Creating a tenant is the platform operator's job. Everyone else gets an
  // explanation instead of a form they'd only be refused on submit — and this
  // page is still where a member-of-nothing lands, so it must say something
  // useful to them rather than 404 or bounce.
  const canCreate = isPlatformOperator(user.email);
  // E-SET-04: the operator's own workspaces, offered as templates with what each would hand on.
  const templates = canCreate
    ? await Promise.all(active.map(async (m) => ({ id: m.workspaceId, name: m.workspace.name, counts: await templateSummary(m.workspaceId) })))
    : [];

  if (!canCreate) {
    // Invitations waiting for this address can't be accepted from here by
    // email alone (anyone can type an email) — the link proves it, or a
    // verified address does. Say which applies.
    const waiting = first ? await pendingInvitationsFor(user.email) : [];
    // A workspace of theirs that was deleted (E-SEC-14) — getCurrentUser leaves
    // it out, which is how they landed here; say so rather than "not a member".
    const gone = first
      ? await db.membership.findMany({
          where: { userId: user.id, status: "active", workspace: { deletedAt: { not: null } } },
          select: { workspace: { select: { name: true, deletedAt: true, purgeAfter: true } } },
        })
      : [];
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="w-full max-w-lg card">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--amber-on)" }} />
            <h1 className="font-mono font-bold text-base">
              {waiting.length > 0 ? "Your invitation is waiting" : gone.length > 0 ? "Your workspace was deleted" : "Workspaces are set up by the administrator"}
            </h1>
          </div>
          {waiting.length > 0 ? (
            <div className="text-sm text-[var(--mute)] leading-relaxed mb-3 space-y-2">
              <p>
                {waiting.length === 1
                  ? <>An invitation to <b>{waiting[0].workspace.name}</b> was sent to <b>{user.email}</b>.</>
                  : <>{waiting.length} invitations were sent to <b>{user.email}</b> ({waiting.map((w) => w.workspace.name).join(", ")}).</>}{" "}
                Open the link in the invitation to join, or confirm this email address and it&apos;s accepted for you.
              </p>
              {user.emailVerified ? null : (
                <form action={resendVerificationAction}>
                  <SubmitButton className="btn sm" pendingText="Sending…">Send the confirmation email again</SubmitButton>
                </form>
              )}
            </div>
          ) : gone.length > 0 ? (
            <div className="text-sm text-[var(--mute)] leading-relaxed mb-3 space-y-1" data-deleted-workspace>
              {gone.map((g) => (
                <p key={g.workspace.name} className="m-0">
                  <b>{g.workspace.name}</b> was deleted{g.workspace.deletedAt ? ` on ${formatDay(g.workspace.deletedAt)}` : ""}. The platform administrator can restore it until {g.workspace.purgeAfter ? formatDay(g.workspace.purgeAfter) : "its purge"} — ask them if that was a mistake.
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--mute)] leading-relaxed mb-3">
              {first
                ? "You're signed in, but you're not a member of any workspace yet. Ask your platform administrator to invite you to one — the invitation link will bring you straight in."
                : "Only the platform administrator can create new workspaces on this install. Ask them to set one up and invite you."}
            </p>
          )}
          <div className="flex gap-2">
            {!first && <Link href="/inbox" className="btn sm">Back to the app</Link>}
            {/* /settings sits inside the app shell, which sends a member of
                nothing straight back here — so it is offered only to members. */}
            {!first && <Link href="/settings" className="btn sm">Your settings</Link>}
            <form action={signOutAction}>
              <SubmitButton className="btn sm" pendingText="Signing out…">Sign out</SubmitButton>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>
            <Building2 className="w-5 h-5" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="font-mono font-bold text-xl leading-tight">
              {first ? "Create your workspace" : "New workspace"}
            </h1>
            <p className="text-xs text-[var(--mute)]">
              {first
                ? "You're not a member of any workspace yet. Create one to get started."
                : "A separate company, with its own brand, content, connections and team."}
            </p>
          </div>
        </div>

        {error && (
          <div className="card mb-3 flex items-start gap-2 text-sm" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--rose-on)" }} />
            {error}
          </div>
        )}

        <form action={createWorkspaceAction} className="card flex flex-col gap-3">
          <input type="hidden" name="returnTo" value="/onboarding/workspace" />
          <ValidatedInput
            label="Workspace name"
            labelClassName="text-micro font-mono uppercase tracking-wider text-[var(--mute)]"
            name="name"
            placeholder="Acme Ltd"
            required
            minLength={2}
            maxLength={60}
            autoComplete="organization"
            className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
          />
          {templates.length > 0 && (
            <fieldset className="border border-[var(--line-2)] rounded-lg p-3 flex flex-col gap-2 text-xs min-w-0" data-template-pick>
              {/* min-w-0: a fieldset's minimum width is its content's, and an option's long label would widen the page on a phone. */}
              <legend className="px-1 text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Start from</legend>
              <select name="templateId" defaultValue="" className="border border-[var(--line-2)] rounded-lg p-2 text-sm w-full min-w-0" aria-label="Start from">
                <option value="">A blank workspace</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {t.counts.dials} dials, {t.counts.slots} slots, {t.counts.motifs} motifs, {t.counts.topics} Topics</option>
                ))}
              </select>
              {TEMPLATE_PARTS.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" name={`part_${p}`} defaultChecked /> {TEMPLATE_PART_LABEL[p]}
                </label>
              ))}
              <p className="text-2xs text-[var(--mute)] m-0">
                Copied only when a workspace is chosen. Never copied: keys, connected accounts and sites, the brand kit,
                people, content, or autonomy — a new workspace starts manual.
              </p>
            </fieldset>
          )}
          <p className="text-2xs text-[var(--mute)] leading-relaxed">
            You&apos;ll be its admin. Everything is scoped per workspace — brand, topics, posts, connected accounts and
            API keys — so nothing is shared with any other company on this install. You can rename it later under
            Admin&nbsp;→&nbsp;Workspace.
          </p>
          <div className="flex justify-end gap-2">
            {!first && <Link href="/settings" className="btn sm">Cancel</Link>}
            <SubmitButton className="btn primary sm" pendingText="Creating…">Create workspace</SubmitButton>
          </div>
        </form>
        {/* A member of nothing has no app shell to sign out from (SHL-11). A
            separate form: forms can't nest. */}
        {first && (
          <form action={signOutAction} className="mt-3 text-right">
            <SubmitButton className="btn sm" pendingText="Signing out…">Sign out</SubmitButton>
          </form>
        )}
      </div>
    </main>
  );
}
