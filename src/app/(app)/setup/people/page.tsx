import { stop } from "@/lib/sentence";
import { ShieldCheck } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { getSetting } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { PeoplePanel } from "@/components/PeoplePanel";
import { Banner } from "@/components/SocialPostCard";
import { setRequireApprovalAction } from "@/app/actions/social-workflow";

// Settings → People: who can do what. Members and roles, invitations (with
// the join link), and the approval dial for social posts. Who may publish an
// article is a role, not a dial: final approval → published is ADMIN-only.

export default async function SetupPeople({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace } = await requireRole("ADMIN");
  const { ok, err } = await searchParams;
  const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h1 className="font-mono text-[22px] font-bold m-0">People</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">Who can do what in {workspace.name}{stop(workspace.name)}</p>
      </div>
      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <section className="card mb-5 flex flex-wrap items-center gap-3" style={requireApproval ? { borderColor: "var(--green-on)" } : undefined}>
        <ShieldCheck className="w-5 h-5" style={{ color: requireApproval ? "var(--green-on)" : "var(--mute)" }} />
        <div className="flex-1 min-w-56">
          <div className="text-sm font-semibold">Social posts need an admin&apos;s approval {requireApproval ? "— on" : "— off"}</div>
          <div className="text-xs text-[var(--mute)]">
            On: a post by a non-admin is held until an admin approves it — nothing unapproved can be sent, scheduled,
            queued or dragged onto the calendar, and under full autonomy the autopilot&apos;s own posts wait here too.
            Off: approved and auto-generated posts take the next free slot. Publishing an <b>article</b> is an admin&apos;s act regardless.
          </div>
        </div>
        <form action={setRequireApprovalAction}>
          <input type="hidden" name="enabled" value={requireApproval ? "false" : "true"} />
          <SubmitButton className={requireApproval ? "btn" : "btn primary"} pendingText="Saving…">{requireApproval ? "Turn off" : "Turn on"}</SubmitButton>
        </form>
      </section>

      <PeoplePanel workspaceId={workspace.id} workspaceName={workspace.name} returnTo="/setup/people" />
    </div>
  );
}
