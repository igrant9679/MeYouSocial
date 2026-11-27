import { redirect } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { requireUser, isPlatformOperator } from "@/lib/acl";
import { signOut } from "@/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { setActiveWorkspaceAction } from "@/app/actions/workspace-switch";
import { holdSentence, workspaceHold } from "@/lib/workspace-hold";
import { trialPolicy } from "@/lib/trial-policy";
import { formatDay } from "@/lib/zoned-dates";

/**
 * Where a member of a workspace on hold lands (2026-11-26, lib/workspace-hold.ts): requireMembership
 * sends them here from every page, action and route. It says why, that nothing was deleted, how to
 * get it back, and offers their other workspaces.
 *
 * ⚠ OUTSIDE the `(app)` route group, like /onboarding/workspace: that group's layout resolves the
 * workspace through requireMembership, which would send a held member straight back here for ever.
 */

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

export default async function OnHoldPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const user = await requireUser();
  const { ws } = await searchParams;
  const active = user.memberships.filter((m) => m.status === "active");
  const here = active.find((m) => m.workspaceId === ws) ?? null;
  const hold = here ? await workspaceHold(here.workspaceId) : null;
  // Not one of theirs, or not held (any more): back into the app.
  if (!here || !hold || isPlatformOperator(user.email)) redirect("/inbox");
  const others = [];
  for (const m of active) {
    if (m.workspaceId !== here.workspaceId && !(await workspaceHold(m.workspaceId))) others.push(m);
  }
  const { membershipUrl } = await trialPolicy();
  const isAdmin = here.role === "ADMIN";
  const lapsed = hold.reason === "membership_lapsed";

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-lg card" data-on-hold={hold.reason}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-11 h-11 rounded-2xl grid place-items-center shrink-0" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
            <PauseCircle className="w-5 h-5" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="font-mono font-bold text-xl leading-tight m-0">{here.workspace.name} is paused</h1>
            <p className="text-xs text-[var(--mute)] m-0">
              {holdSentence(hold.reason)}
              {hold.since ? ` Since ${formatDay(hold.since)}.` : ""}
            </p>
          </div>
        </div>
        <div className="text-sm text-[var(--mute)] leading-relaxed space-y-2 mb-4">
          <p className="m-0">
            Nothing has been deleted: articles, posts, ideas, brand and settings are kept as they were. While it&apos;s paused nobody
            can open it, nothing is published, and no AI runs.
          </p>
          {isAdmin ? (
            <p className="m-0">
              {lapsed ? "Renew" : "Become a member"} at{" "}
              <a href={membershipUrl} className="text-[var(--accent-on)] font-semibold">meyousocial.com</a> with this email (<b>{user.email}</b>)
              and the workspace opens again as it was — usually within a minute.
            </p>
          ) : (
            <p className="m-0">Ask the workspace&apos;s admin to {lapsed ? "renew its membership" : "become a member"} at meyousocial.com — it opens again as it was.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <a href={membershipUrl} className="btn primary sm">
              {lapsed ? "Renew the membership" : "Become a member"}
            </a>
          )}
          {others.map((m) => (
            <form key={m.workspaceId} action={setActiveWorkspaceAction}>
              <input type="hidden" name="workspaceId" value={m.workspaceId} />
              <SubmitButton className="btn sm" pendingText="Switching…">Open {m.workspace.name}</SubmitButton>
            </form>
          ))}
          <form action={signOutAction}>
            <SubmitButton className="btn sm" pendingText="Signing out…">Sign out</SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
