import Link from "next/link";
import { Building2, AlertTriangle } from "lucide-react";
import { requireUser } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { createWorkspaceAction } from "@/app/actions/workspace-switch";

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
            labelClassName="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]"
            name="name"
            placeholder="Acme Ltd"
            required
            minLength={2}
            maxLength={60}
            autoComplete="organization"
            className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
          />
          <p className="text-[11px] text-[var(--mute)] leading-relaxed">
            You&apos;ll be its admin. Everything is scoped per workspace — brand, topics, posts, connected accounts and
            API keys — so nothing is shared with any other company on this install. You can rename it later under
            Admin&nbsp;→&nbsp;Workspace.
          </p>
          <div className="flex justify-end gap-2">
            {!first && <Link href="/settings" className="btn sm">Cancel</Link>}
            <SubmitButton className="btn primary sm" pendingText="Creating…">Create workspace</SubmitButton>
          </div>
        </form>
      </div>
    </main>
  );
}
