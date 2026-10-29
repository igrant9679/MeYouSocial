import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { requestNow } from "@/lib/request-time";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { currentIncident, sessionsValidAfter, RECONNECT_KEYS, type IncidentStep } from "@/lib/incident";
import { declareIncidentAction, endIncidentAction } from "@/app/actions/incident";
import { SubmitButton } from "@/components/SubmitButton";

// Settings → Incident (E-SEC-06): the platform operator's response to a leak,
// across every workspace. Each step says how much it touches before it runs.
// Times are UTC — this page isn't any one workspace's.

const STEP_LABEL: Record<IncidentStep, string> = {
  sessions: "Sign everyone out",
  invitations: "Void open invitations",
  tokens: "Revoke every API token",
  oauth: "Disconnect YouTube and Analytics sign-ins",
};

export default async function IncidentPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const now = new Date(requestNow());
  const [incident, after, users, workspaces, invites, tokens, oauthRows] = await Promise.all([
    currentIncident(),
    sessionsValidAfter(),
    db.user.count(),
    db.workspace.count(),
    db.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
    db.apiToken.count({ where: { revokedAt: null } }),
    db.workspaceSetting.findMany({ where: { key: { in: [...RECONNECT_KEYS] }, NOT: { value: "" } }, select: { workspaceId: true } }),
  ]);
  const oauthWorkspaces = new Set(oauthRows.map((r) => r.workspaceId)).size;
  const counts: Record<IncidentStep, string> = {
    sessions: `every signed-in person (${users} accounts), you included — within about 30 seconds`,
    invitations: `${invites} open invitation${invites === 1 ? "" : "s"} — expired, kept as the record`,
    tokens: `${tokens} live token${tokens === 1 ? "" : "s"} — anything calling /api/v1 stops`,
    oauth: `${oauthRows.length} connection${oauthRows.length === 1 ? "" : "s"} in ${oauthWorkspaces} workspace${oauthWorkspaces === 1 ? "" : "s"} — each must be reconnected; Drive storage is left alone`,
  };

  return (
    <main className="w-full max-w-3xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          <ShieldAlert className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">Incident mode</h1>
          <p className="text-xs text-[var(--mute)] m-0">For a leak: the steps run across all {workspaces} workspaces, each workspace&apos;s audit log records them, and its admins are told and see a banner until you end it.</p>
        </div>
      </div>

      {incident ? (
        <section className="card mb-4 text-xs flex flex-col gap-2" style={{ borderColor: "var(--rose)" }}>
          <b style={{ color: "var(--rose-on)" }}>An incident is open — since {formatZonedMoment(new Date(incident.since), "UTC")}, declared by {incident.by}.</b>
          <p className="m-0">{incident.note}</p>
          <p className="m-0 text-[var(--mute)]">Steps taken: {incident.steps.map((s) => STEP_LABEL[s]).join(" · ") || "none"}.</p>
          <form action={endIncidentAction}>
            <SubmitButton className="btn sm" pendingText="…">End incident mode</SubmitButton>
          </form>
          <span className="text-[var(--mute)]">Ending it removes the banner. Nothing the steps did is undone.</span>
        </section>
      ) : (
        <p className="text-xs text-[var(--mute)] mb-4">No incident is open.{after ? ` Everyone was last signed out ${formatZonedMoment(new Date(after), "UTC")}.` : ""}</p>
      )}

      <form action={declareIncidentAction} className="card text-xs flex flex-col gap-3">
        <b>{incident ? "Run steps again" : "Declare an incident"}</b>
        <label className="flex flex-col gap-1">
          <span className="text-[var(--mute)]">What happened — every admin reads this</span>
          <textarea name="note" required maxLength={500} rows={3} className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs" placeholder="e.g. A database backup was exposed; replace your keys." />
        </label>
        <fieldset className="flex flex-col gap-2 m-0 p-0 border-0">
          {(Object.keys(STEP_LABEL) as IncidentStep[]).map((s) => (
            <label key={s} className="flex items-start gap-2">
              <input type="checkbox" name={`step_${s}`} defaultChecked={s !== "oauth"} className="mt-0.5" />
              <span><b>{STEP_LABEL[s]}</b> <span className="text-[var(--mute)]">— {counts[s]}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-start gap-2" style={{ color: "var(--rose-on)" }}>
          <input type="checkbox" name="confirm" value="yes" className="mt-0.5" />
          <span>I understand these steps can&apos;t be undone.</span>
        </label>
        <div>
          <SubmitButton className="btn sm" pendingText="Running…">{incident ? "Run these steps" : "Declare the incident"}</SubmitButton>
        </div>
        <span className="text-[var(--mute)]">After it: replace the keys that may have leaked (each workspace&apos;s Keys page has a rotation checklist) and check People.</span>
      </form>
    </main>
  );
}
