import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getPublicUrl } from "@/lib/public-url";
import { requestNow } from "@/lib/request-time";
import { formatZonedMoment, formatDay } from "@/lib/zoned-dates";
import { trialPolicy, TRIAL_DEFAULTS, TRIAL_SUGGESTED_DAYS, SIGNUP_KEYS } from "@/lib/trial-policy";
import { TEMPLATE_PARTS, TEMPLATE_PART_LABEL } from "@/lib/workspace-template";
import { holdSentence, trialState, workspaceHold } from "@/lib/workspace-hold";
import { readPlans, PLAN_ACCESS, PLAN_ACCESS_LABEL } from "@/lib/membership/plans";
import { PREVIOUS_SECRET_GRACE_MS, PREVIOUS_SECRET_KEY, ROTATED_AT_KEY, SECRET_KEY, secretFingerprint } from "@/lib/membership/signature";
import {
  saveTrialSettingsAction,
  dropPreviousSecretAction,
  savePlanAction,
  removePlanAction,
  reprocessEventAction,
  trialLeverAction,
} from "@/app/actions/signups";
import { SigningSecretForm } from "@/components/SigningSecretForm";
import { SubmitButton } from "@/components/SubmitButton";
import { CopyButton } from "@/components/CopyButton";

// Settings → Sign-ups (2026-11-26, the owner's "sign up a new workspace from the website and from
// within the app"), platform operator only. The two doors a workspace comes through — Publisher's own
// sign-up (a free trial) and a meyousocial.com membership (signed calls to /api/membership/events) —
// their settings, and what came through them. The website's side is docs/WEBSITE-SIGNUP-INTEGRATION.md.

export const dynamic = "force-dynamic";

const OUTCOME_TONE: Record<string, string> = {
  pong: "green", invited: "green", attached: "green", reactivated: "green", linked: "green",
  unchanged: "mute", stale: "mute", lapsed: "amber", ignored: "amber", refused: "rose", failed: "rose",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const style = tone === "mute" ? { background: "var(--line)", color: "var(--mute)" } : { background: `var(--${tone}-soft)`, color: `var(--${tone}-on)` };
  return <span className="inline-block rounded-full px-2 py-0.5 text-2xs font-semibold" style={style}>{children}</span>;
}

export default async function SignupsPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const zone = user.timeZone ?? "UTC";
  const now = requestNow();
  const origin = await getPublicUrl();
  const endpoint = `${origin}/api/membership/events`;

  const [policy, raw, secret, previous, rotatedAt, plans, workspaces, trialRows, grants, events] = await Promise.all([
    trialPolicy(),
    Promise.all(Object.values(SIGNUP_KEYS).map((k) => getSetting(k))).then((v) => Object.fromEntries(Object.keys(SIGNUP_KEYS).map((k, i) => [k, v[i]]))),
    getSetting(SECRET_KEY),
    getSetting(PREVIOUS_SECRET_KEY),
    getSetting(ROTATED_AT_KEY),
    readPlans(),
    db.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.workspace.findMany({
      where: { deletedAt: null, OR: [{ trialEndsAt: { not: null } }, { heldAt: { not: null } }, { signupSource: { not: null } }] },
      select: {
        id: true, name: true, createdAt: true, signupSource: true, trialEndsAt: true, heldAt: true, holdReason: true,
        memberships: { where: { role: "ADMIN", status: "active" }, select: { user: { select: { email: true } } }, take: 1, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.membershipGrant.findMany({ orderBy: { updatedAt: "desc" }, take: 60, include: { workspace: { select: { name: true, deletedAt: true } } } }),
    db.membershipEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 50 }),
  ]);
  const graceUntil = previous && rotatedAt ? Date.parse(rotatedAt) + PREVIOUS_SECRET_GRACE_MS : 0;
  const graceOpen = graceUntil > now;
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const trials = await Promise.all(
    trialRows.map(async (w) => ({
      ...w,
      admin: w.memberships[0]?.user.email ?? null,
      state: w.trialEndsAt ? await trialState(w.id).catch(() => null) : null,
      hold: await workspaceHold(w.id),
    })),
  );
  const mapped = new Set(plans.map((p) => p.id));
  const unmapped = [...new Map(events.filter((e) => e.externalPlanId && !mapped.has(e.externalPlanId)).map((e) => [e.externalPlanId!, e])).values()];
  const lastCall = events[0]?.receivedAt ?? null;
  const field = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

  return (
    <main className="w-full max-w-4xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>
          <UserPlus className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">Sign-ups</h1>
          <p className="text-xs text-[var(--mute)] m-0">
            Two ways a new workspace starts: anyone can begin a <b>free trial</b>{" "}from Publisher&apos;s own sign-up page, and a
            <b> meyousocial.com membership</b> makes one (or keeps a trial going) through signed calls from the website. When a trial
            ends or a membership lapses the workspace is paused, never deleted.
          </p>
        </div>
      </div>

      {/* ── The free trial ── */}
      <section id="trial" className="card mb-4 text-xs flex flex-col gap-3 scroll-mt-20">
        <div>
          <h2 className="text-sm font-semibold m-0">Free trial — Publisher&apos;s sign-up page</h2>
          <p className="m-0 text-[var(--mute)]">
            {policy.days > 0 ? (
              <>Open: anyone can start one at <a className="underline" href={`${origin}/signup`}>{origin}/signup</a> — one per person, three a day per address.</>
            ) : (
              <>Off: sign-up is by invitation only. Enter the days below ({TRIAL_SUGGESTED_DAYS} is the suggested length) to open it.</>
            )}{" "}
            Trials run on the platform&apos;s AI keys, render video only as the named placeholder, and start manual. Blank fields use the default.
          </p>
        </div>
        <form action={saveTrialSettingsAction} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Days (0 = trials off)</span>
            <input name="days" inputMode="numeric" defaultValue={raw.trialDays} placeholder={`${TRIAL_DEFAULTS.days} — off (try ${TRIAL_SUGGESTED_DAYS})`} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">AI tokens per trial</span>
            <input name="tokenCap" inputMode="numeric" defaultValue={raw.tokenCap} placeholder={TRIAL_DEFAULTS.tokenCap.toLocaleString("en-GB")} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Pictures per trial</span>
            <input name="imageCap" inputMode="numeric" defaultValue={raw.imageCap} placeholder={String(TRIAL_DEFAULTS.imageCap)} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Trials running at once (0 = no cap)</span>
            <input name="maxOpen" inputMode="numeric" defaultValue={raw.maxOpen} placeholder={String(TRIAL_DEFAULTS.maxOpen)} className={field} />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[var(--mute)]">Where “Become a member” goes</span>
            <input name="membershipUrl" type="url" defaultValue={raw.membershipUrl} placeholder={TRIAL_DEFAULTS.membershipUrl} className={field} />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[var(--mute)]">New workspaces start from (trials and members)</span>
            <select name="templateId" defaultValue={raw.templateId} className={field}>
              <option value="">A blank workspace</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <fieldset className="col-span-2 sm:col-span-4 flex flex-wrap gap-3 min-w-0">
            <legend className="text-[var(--mute)] mb-1">Copied from it</legend>
            {TEMPLATE_PARTS.map((p) => (
              <label key={p} className="inline-flex items-center gap-1.5">
                <input type="checkbox" name={`part_${p}`} defaultChecked={policy.templateParts.includes(p)} /> {TEMPLATE_PART_LABEL[p]}
              </label>
            ))}
            <span className="text-[var(--mute)] basis-full">Never copied: keys, connected accounts, the brand kit, people, content or autonomy.</span>
          </fieldset>
          <div className="col-span-2 sm:col-span-4 flex justify-end">
            <SubmitButton className="btn sm primary" pendingText="Saving…">Save the trial settings</SubmitButton>
          </div>
        </form>
        <p className="m-0 text-[var(--mute)]">
          Now: {policy.days} days, {policy.tokenCap > 0 ? `${policy.tokenCap.toLocaleString("en-GB")} tokens` : "no token limit"},{" "}
          {policy.imageCap > 0 ? `${policy.imageCap} pictures` : "no picture limit"}, {policy.maxOpen > 0 ? `at most ${policy.maxOpen} at once` : "no cap on trials at once"}.
          A streamed reply that reports no size counts as 3,000 tokens.
        </p>
      </section>

      {/* ── The website connection ── */}
      <section id="website" className="card mb-4 text-xs flex flex-col gap-3 scroll-mt-20">
        <div>
          <h2 className="text-sm font-semibold m-0">meyousocial.com — the website&apos;s connection</h2>
          <p className="m-0 text-[var(--mute)]">
            The website tells Publisher when a member&apos;s plan starts and ends, and asks where a member goes now. Give its developer
            the address, the secret and <code className="font-code">docs/WEBSITE-SIGNUP-INTEGRATION.md</code>{" "}from Publisher&apos;s repository.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[var(--mute)]">Address (POST, JSON)</span>
          <div className="flex items-center gap-2">
            <code className="font-code break-all flex-1" data-endpoint>{endpoint}</code>
            <CopyButton text={endpoint} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[var(--mute)]">Signing secret</span>
          <p className="m-0" data-secret-state={secret ? "set" : "unset"}>
            {secret ? <>Set — fingerprint <b className="font-code">{secretFingerprint(secret)}</b>.</> : <>Not made yet: until it is, every call is refused.</>}
            {graceOpen && <> The previous one ({secretFingerprint(previous)}) still works until {formatZonedMoment(new Date(graceUntil), zone)}.</>}
          </p>
          <SigningSecretForm hasSecret={Boolean(secret)} />
          {graceOpen && (
            <form action={dropPreviousSecretAction}>
              <SubmitButton className="btn sm" pendingText="Stopping…">Stop accepting the previous secret now</SubmitButton>
            </form>
          )}
        </div>
        <p className="m-0 text-[var(--mute)]">
          {lastCall ? <>Last call received {formatZonedMoment(lastCall, zone)}.</> : <>No call received yet — the website&apos;s first test is a <code className="font-code">ping</code>.</>}
        </p>
      </section>

      {/* ── What each membership gives ── */}
      <section id="plans" className="card mb-4 text-xs flex flex-col gap-3 scroll-mt-20">
        <div>
          <h2 className="text-sm font-semibold m-0">What each membership gives in Publisher</h2>
          <p className="m-0 text-[var(--mute)]">
            Keyed by the MemberPress membership id the website sends. A membership not listed gives nothing — its calls show as
            “ignored” below and can be processed again once it&apos;s listed.
          </p>
        </div>
        {plans.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[var(--mute)]"><th className="py-1">Membership</th><th className="py-1">Gives</th><th /></tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-[var(--line)]" data-plan={p.id}>
                  <td className="py-1.5"><b className="font-code">{p.id}</b>{p.label ? ` — ${p.label}` : ""}</td>
                  <td className="py-1.5">
                    {PLAN_ACCESS_LABEL[p.access]}
                    {p.access === "join" && <> — {wsName.get(p.workspaceId ?? "") ?? "a deleted workspace"} as {(p.role ?? "EDITOR").toLowerCase()}</>}
                    {p.access === "workspace" && p.templateId && <> — starting from {wsName.get(p.templateId) ?? "a deleted workspace"}</>}
                  </td>
                  <td className="py-1.5 text-right">
                    <form action={removePlanAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton className="btn sm" pendingText="Removing…">Remove</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {unmapped.length > 0 && (
          <p className="m-0" style={{ color: "var(--amber-on)" }} data-unmapped>
            Sent by the website but not listed: {unmapped.map((e) => e.externalPlanId).join(", ")}.
          </p>
        )}
        <form action={savePlanAction} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Membership id</span>
            <input name="id" required maxLength={64} defaultValue={unmapped[0]?.externalPlanId ?? ""} placeholder="7834" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Name</span>
            <input name="label" maxLength={80} placeholder="Steward" className={field} />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[var(--mute)]">Gives</span>
            <select name="access" defaultValue="workspace" className={field}>
              {PLAN_ACCESS.map((a) => <option key={a} value={a}>{PLAN_ACCESS_LABEL[a]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Seat in (join) / start from (own)</span>
            <select name="workspaceId" defaultValue="" className={field}>
              <option value="">—</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--mute)]">Seat role (join)</span>
            <select name="role" defaultValue="EDITOR" className={field}>
              <option value="ADMIN">admin</option>
              <option value="EDITOR">editor</option>
              <option value="VIEWER">viewer</option>
            </select>
          </label>
          <div className="col-span-2 sm:col-span-6 flex justify-end">
            <SubmitButton className="btn sm primary" pendingText="Saving…">Save the membership</SubmitButton>
          </div>
        </form>
      </section>

      {/* ── Trials and held workspaces ── */}
      <section id="trials" className="card mb-4 text-xs flex flex-col gap-2 scroll-mt-20">
        <h2 className="text-sm font-semibold m-0">Workspaces that came through sign-up</h2>
        {trials.length === 0 ? (
          <p className="m-0 text-[var(--mute)]">None yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[var(--mute)]"><th className="py-1">Workspace</th><th className="py-1">Admin</th><th className="py-1">Standing</th><th /></tr>
            </thead>
            <tbody>
              {trials.map((w) => (
                <tr key={w.id} className="border-t border-[var(--line)] align-top" data-signup-workspace={w.id}>
                  <td className="py-1.5">
                    <b>{w.name}</b>
                    <div className="text-[var(--mute)]">{w.signupSource === "website" ? "membership" : w.signupSource === "app" ? "trial sign-up" : "made here"} · {formatDay(w.createdAt, zone)}</div>
                  </td>
                  <td className="py-1.5 break-all">{w.admin ?? <span className="text-[var(--mute)]">not joined yet</span>}</td>
                  <td className="py-1.5">
                    {w.hold ? (
                      <Pill tone="rose">{holdSentence(w.hold.reason)}</Pill>
                    ) : w.state ? (
                      <span>
                        <Pill tone="amber">trial</Pill> {w.state.daysLeft} days left · {w.state.usedPct}% used ({w.state.usage.tokens.toLocaleString("en-GB")} tokens
                        {w.state.usage.uncountedCalls ? ` + ${w.state.usage.uncountedCalls} unsized` : ""}, {w.state.usage.images} pictures)
                      </span>
                    ) : (
                      <Pill tone="green">member workspace</Pill>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {w.trialEndsAt && (
                      <>
                        <form action={trialLeverAction} className="inline">
                          <input type="hidden" name="workspaceId" value={w.id} />
                          <input type="hidden" name="lever" value="extend" />
                          <SubmitButton className="btn sm" pendingText="…">+7 days</SubmitButton>
                        </form>{" "}
                        <form action={trialLeverAction} className="inline">
                          <input type="hidden" name="workspaceId" value={w.id} />
                          <input type="hidden" name="lever" value="keep" />
                          <SubmitButton className="btn sm" pendingText="…">End the trial terms</SubmitButton>
                        </form>
                      </>
                    )}
                    {w.heldAt && (
                      <form action={trialLeverAction} className="inline">
                        <input type="hidden" name="workspaceId" value={w.id} />
                        <input type="hidden" name="lever" value="lift" />
                        <SubmitButton className="btn sm" pendingText="…">Lift the hold</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Members from the website ── */}
      <section id="members" className="card mb-4 text-xs flex flex-col gap-2 scroll-mt-20">
        <h2 className="text-sm font-semibold m-0">Members from meyousocial.com</h2>
        {grants.length === 0 ? (
          <p className="m-0 text-[var(--mute)]">None yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[var(--mute)]"><th className="py-1">Member</th><th className="py-1">Membership</th><th className="py-1">Workspace</th><th className="py-1">Standing</th></tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-t border-[var(--line)]" data-grant={g.id}>
                  <td className="py-1.5 break-all">{g.email}<div className="text-[var(--mute)]">WordPress user {g.externalMemberId}</div></td>
                  <td className="py-1.5">{g.planName ?? g.externalPlanId}<div className="text-[var(--mute)]">{g.access === "join" ? `a seat (${g.role.toLowerCase()})` : "own workspace"}</div></td>
                  <td className="py-1.5">{g.workspace ? `${g.workspace.name}${g.workspace.deletedAt ? " (deleted)" : ""}` : "—"}</td>
                  <td className="py-1.5"><Pill tone={g.status === "active" ? "green" : "amber"}>{g.status === "active" ? "active" : "ended"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── The log ── */}
      <section id="events" className="card mb-4 text-xs flex flex-col gap-2 scroll-mt-20">
        <h2 className="text-sm font-semibold m-0">Calls from the website — the last 50</h2>
        {events.length === 0 ? (
          <p className="m-0 text-[var(--mute)]">None yet.</p>
        ) : (
          <table className="w-full">
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-[var(--line)] align-top" data-event={e.eventId}>
                  <td className="py-1.5 whitespace-nowrap text-[var(--mute)]">{formatZonedMoment(e.receivedAt, zone)}</td>
                  <td className="py-1.5"><span className="font-code">{e.type}</span>{e.email ? <div className="text-[var(--mute)] break-all">{e.email}{e.externalPlanId ? ` · ${e.externalPlanId}` : ""}</div> : null}</td>
                  <td className="py-1.5"><Pill tone={OUTCOME_TONE[e.outcome ?? ""] ?? "mute"}>{e.outcome ?? "running"}</Pill> {e.detail}</td>
                  <td className="py-1.5 text-right">
                    {(e.outcome === "ignored" || e.outcome === "failed") && (
                      <form action={reprocessEventAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <SubmitButton className="btn sm" pendingText="Processing…">Process again</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
