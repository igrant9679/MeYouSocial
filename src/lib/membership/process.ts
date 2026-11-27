import { nanoid } from "nanoid";
import type { MembershipGrant, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { forgetHold, workspaceHold } from "@/lib/workspace-hold";
import { createWorkspace, workspaceNameFor } from "@/lib/workspace-signup";
import { trialPolicy } from "@/lib/trial-policy";
import { eventSchema, firstIssue, type MemberCall, type MembershipCall } from "@/lib/membership/contract";
import { planFor, type PlanRule } from "@/lib/membership/plans";
import {
  PREVIOUS_SECRET_GRACE_MS,
  PREVIOUS_SECRET_KEY,
  ROTATED_AT_KEY,
  SECRET_KEY,
  verifySignature,
} from "@/lib/membership/signature";

// What Publisher does with a call from meyousocial.com (2026-11-26). The route
// (app/api/membership/events) hands the raw body here; this checks the signature, applies the
// event once, logs it (MembershipEvent — Settings → Sign-ups) and answers. Every answer says what
// happened in words and, for a member, where they go now:
//   link.kind "claim"   — their invitation (/invitations/<token>): create an account or sign in, then in
//   link.kind "sign_in" — they're already in: /signin
// ⚠ The website decides what a member HAS; Publisher decides what each plan GIVES (plans.ts). An
// event can't name a workspace or a role.

export const SOURCE = "meyousocial.com";
export const INVITE_DAYS = 30;

export type Outcome =
  | "pong"
  | "invited"
  | "attached"
  | "reactivated"
  | "unchanged"
  | "lapsed"
  | "linked"
  | "stale"
  | "ignored"
  | "refused"
  | "failed"
  | "not_set_up"
  | "unauthorized"
  | "bad_request"
  | "in_progress";

export type Link = { kind: "claim"; url: string; expiresAt: string } | { kind: "sign_in"; url: string };
export type WorkspaceRef = { id: string; name: string; held: string | null; trialEndsAt: string | null };
export type GrantRef = { plan: { id: string; name: string | null }; status: string; access: string; workspace: WorkspaceRef | null; link: Link | null };

export type Answer = {
  ok: boolean;
  outcome: Outcome;
  message: string;
  eventId?: string;
  duplicate?: boolean;
  workspace?: WorkspaceRef | null;
  link?: Link | null;
  grants?: GrantRef[];
};

type Applied = { answer: Answer; grantId?: string | null };

const answer = (ok: boolean, outcome: Outcome, message: string, extra: Partial<Answer> = {}): Answer => ({ ok, outcome, message, ...extra });

// ── The front door ──────────────────────────────────────────────────────────

/** Check, log once, apply, answer. `origin` is Publisher's public address (for links). */
export async function handleMembershipCall(input: { rawBody: string; signature: string | null; origin: string }): Promise<{ status: number; body: Answer }> {
  const [secret, previous, rotatedAt] = await Promise.all([getSetting(SECRET_KEY), getSetting(PREVIOUS_SECRET_KEY), getSetting(ROTATED_AT_KEY)]);
  if (!secret) {
    return { status: 503, body: answer(false, "not_set_up", "Publisher has no signing secret yet: the operator makes one on Settings → Sign-ups.") };
  }
  const graceOpen = previous && Date.now() - Date.parse(rotatedAt || "0") < PREVIOUS_SECRET_GRACE_MS;
  const check = verifySignature(graceOpen ? [secret, previous] : [secret], input.signature, input.rawBody);
  if (!check.ok) {
    const why = {
      missing: "No X-MeYouSocial-Signature header.",
      malformed: "The X-MeYouSocial-Signature header must read t=<unix seconds>,v1=<64 hex characters>.",
      stale: "The signature's time is more than five minutes from Publisher's clock — sign each call when it is sent.",
      mismatch: "The signature doesn't match: sign \"<t>.<the exact body sent>\" with the secret from Settings → Sign-ups.",
    }[check.why];
    return { status: 401, body: answer(false, "unauthorized", why) };
  }
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: answer(false, "bad_request", "The body isn't JSON.") };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: answer(false, "bad_request", firstIssue(parsed.error)) };
  const evt = parsed.data;

  // Once per event id. A repeat gets the first answer; an event that was ignored or failed is
  // tried again (the operator may have mapped the plan since); one still running asks to retry.
  const logged = await claimEvent(evt, json);
  if (logged.kind === "done") return { status: 200, body: { ...logged.answer, duplicate: true } };
  if (logged.kind === "busy") return { status: 409, body: answer(false, "in_progress", "This event is being applied right now — retry in a minute.", { eventId: evt.id }) };
  return finish(logged.rowId, evt, input.origin);
}

/** Apply a logged event again — Settings → Sign-ups' "Process again" (no signature: it was checked when it came). */
export async function reprocessEvent(rowId: string, origin: string): Promise<Answer> {
  const row = await db.membershipEvent.findUnique({ where: { id: rowId } });
  if (!row) return answer(false, "failed", "That event isn't in the log any more.");
  const parsed = eventSchema.safeParse(row.payload);
  if (!parsed.success) return answer(false, "bad_request", firstIssue(parsed.error));
  return (await finish(row.id, parsed.data, origin)).body;
}

async function finish(rowId: string, evt: MembershipCall, origin: string): Promise<{ status: number; body: Answer }> {
  let applied: Applied;
  try {
    applied = await apply(evt, origin);
  } catch (e) {
    console.error("[membership] applying", evt.type, evt.id, "failed:", e);
    applied = { answer: answer(false, "failed", `Publisher couldn't apply this event: ${e instanceof Error ? e.message : String(e)}. Retry with the same id.`) };
  }
  const body = { ...applied.answer, eventId: evt.id };
  // A failure keeps no stored answer, so the same id is applied again when retried.
  await db.membershipEvent.update({
    where: { id: rowId },
    data: {
      outcome: body.outcome,
      detail: body.message.slice(0, 500),
      response: body.outcome === "failed" ? undefined : (body as unknown as Prisma.InputJsonValue),
      grantId: applied.grantId ?? null,
      processedAt: new Date(),
    },
  });
  return { status: body.outcome === "failed" ? 500 : 200, body };
}

const RETRYABLE = new Set(["ignored", "failed"]);
const STUCK_MS = 2 * 60_000;

async function claimEvent(evt: MembershipCall, payload: unknown): Promise<{ kind: "new"; rowId: string } | { kind: "done"; answer: Answer } | { kind: "busy" }> {
  const member = evt.type === "ping" ? null : evt.member;
  const plan = evt.type === "ping" ? null : evt.membership ?? null;
  // skipDuplicates: a repeated id is an answer, not an error (and leaves no error in the logs).
  const made = await db.membershipEvent.createMany({
    data: [
      {
        eventId: evt.id,
        type: evt.type,
        email: member?.email ?? null,
        externalMemberId: member?.id ?? null,
        externalPlanId: plan?.id ?? null,
        payload: payload as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  if (made.count === 1) {
    const row = await db.membershipEvent.findUnique({ where: { eventId: evt.id }, select: { id: true } });
    if (row) return { kind: "new", rowId: row.id };
  }
  const prior = await db.membershipEvent.findUnique({ where: { eventId: evt.id } });
  if (!prior) return { kind: "busy" };
  if (prior.response && !RETRYABLE.has(prior.outcome ?? "")) return { kind: "done", answer: prior.response as unknown as Answer };
  const stuck = !prior.processedAt && Date.now() - prior.receivedAt.getTime() > STUCK_MS;
  if (prior.processedAt || stuck) {
    // Take it over atomically: only one retry wins.
    const won = await db.membershipEvent.updateMany({
      where: { id: prior.id, receivedAt: prior.receivedAt },
      data: { receivedAt: new Date(), processedAt: null, payload: payload as Prisma.InputJsonValue },
    });
    if (won.count) return { kind: "new", rowId: prior.id };
  }
  return { kind: "busy" };
}

// ── Applying an event ───────────────────────────────────────────────────────

async function apply(evt: MembershipCall, origin: string): Promise<Applied> {
  switch (evt.type) {
    case "ping":
      return { answer: answer(true, "pong", "Signature checked — Publisher is listening.") };
    case "membership.activated":
      return activate(evt, origin);
    case "membership.deactivated":
      return deactivate(evt);
    case "membership.link":
      return link(evt, origin);
  }
}

const findGrant = (memberId: string, planId: string) =>
  db.membershipGrant.findUnique({ where: { source_externalMemberId_externalPlanId: { source: SOURCE, externalMemberId: memberId, externalPlanId: planId } } });

/** An older event arriving after a newer one changes nothing. */
function isStale(grant: MembershipGrant | null, evt: MemberCall): boolean {
  return Boolean(grant && evt.occurredAt.getTime() < grant.lastEventAt.getTime());
}

async function activate(evt: Extract<MembershipCall, { type: "membership.activated" }>, origin: string): Promise<Applied> {
  const { member, membership } = evt;
  const planLabel = membership.name || `membership ${membership.id}`;
  let grant = await findGrant(member.id, membership.id);
  if (isStale(grant, evt)) return { answer: await withLinks(answer(true, "stale", "An older event than the last one applied — nothing changed."), grant!, origin), grantId: grant!.id };

  if (grant) {
    const data: Prisma.MembershipGrantUncheckedUpdateInput = { lastEventAt: evt.occurredAt, name: member.name ?? grant.name, planName: membership.name ?? grant.planName };
    // A changed address: an invitation not yet used is withdrawn, so the next link goes to the new one.
    if (grant.email !== member.email) {
      data.email = member.email;
      if (grant.invitationId) {
        await db.invitation.deleteMany({ where: { id: grant.invitationId, acceptedAt: null } });
        data.invitationId = null;
      }
    }
    // Their own workspace is gone (deleted, or never made because a step failed): a new one, as
    // for a first activation — whatever the grant's standing, so a retry heals it.
    // A grant claimed moments ago with no workspace yet is another event still making it.
    if (grant.access === "workspace" && !grant.workspaceId && Date.now() - grant.createdAt.getTime() < 2 * 60_000) {
      return { answer: answer(true, "unchanged", `${planLabel}: the workspace is being made right now — ask for the link again in a minute.`, { workspace: null, link: null }), grantId: grant.id };
    }
    if (grant.access === "workspace" && !(grant.workspaceId && (await liveWorkspace(grant.workspaceId)))) {
      const ws = await newMemberWorkspace(evt, await planFor(membership.id));
      grant = await db.membershipGrant.update({ where: { id: grant.id }, data: { ...data, status: "active", workspaceId: ws.id, invitationId: null } });
      await auditGrant(grant, "membership.granted", { plan: planLabel, note: "no live workspace; a new one was made" });
      return { answer: await withLinks(answer(true, "invited", `${planLabel} is active: workspace ${ws.name} is ready for ${member.email}.`), grant, origin), grantId: grant.id };
    }
    if (grant.status === "active") {
      grant = await db.membershipGrant.update({ where: { id: grant.id }, data });
      return { answer: await withLinks(answer(true, "unchanged", `${planLabel} was already active — nothing changed.`), grant, origin), grantId: grant.id };
    }
    // It lapsed and is back.
    grant = await db.membershipGrant.update({ where: { id: grant.id }, data: { ...data, status: "active" } });
    if (grant.access === "workspace" && grant.workspaceId) {
      await db.workspace.updateMany({ where: { id: grant.workspaceId, holdReason: "membership_lapsed" }, data: { heldAt: null, holdReason: null } });
      forgetHold(grant.workspaceId);
    }
    if (grant.access === "join" && grant.revokedMembershipId) {
      await db.membership.updateMany({ where: { id: grant.revokedMembershipId, status: "revoked" }, data: { status: "active" } });
      grant = await db.membershipGrant.update({ where: { id: grant.id }, data: { revokedMembershipId: null } });
    }
    await auditGrant(grant, "membership.reactivated", { plan: planLabel });
    return { answer: await withLinks(answer(true, "reactivated", `${planLabel} is active again — access is back.`), grant, origin), grantId: grant.id };
  }

  const plan = await planFor(membership.id);
  if (!plan) return { answer: answer(true, "ignored", `${planLabel} (id ${membership.id}) isn't mapped to anything in Publisher yet — map it on Settings → Sign-ups, then retry this event.`) };
  if (plan.access === "none") return { answer: answer(true, "ignored", `${planLabel} gives nothing in Publisher (Settings → Sign-ups).`) };

  if (plan.access === "join") {
    const ws = plan.workspaceId ? await liveWorkspace(plan.workspaceId) : null;
    if (!ws) return { answer: answer(false, "failed", `${planLabel} gives a seat in a workspace that no longer exists — choose another on Settings → Sign-ups.`) };
    const { joinRefusal } = await import("@/lib/access-policy");
    const refusal = await joinRefusal(ws.id, member.email);
    if (refusal) return { answer: answer(false, "refused", `${member.email} can't join ${ws.name}: ${refusal}`) };
    const claimed = await claimGrant(evt, { access: "join", workspaceId: ws.id, role: plan.role ?? "EDITOR" });
    if (!claimed) return activate(evt, origin);
    await auditGrant(claimed, "membership.granted", { plan: planLabel, role: claimed.role });
    return { answer: await withLinks(answer(true, "invited", `${member.email} has a seat in ${ws.name} as ${claimed.role.toLowerCase()}.`), claimed, origin), grantId: claimed.id };
  }

  // Their own workspace. One they already have keeps going: another plan's (an upgrade or a
  // second plan), else their free trial's — the trial becomes a member workspace.
  const sibling = await db.membershipGrant.findFirst({
    where: { source: SOURCE, externalMemberId: member.id, access: "workspace", workspaceId: { not: null }, workspace: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
  });
  const trial = sibling ? null : await ownTrialWorkspace(member.email);
  const kept = sibling?.workspaceId ?? trial?.id ?? null;
  // The member and plan are claimed BEFORE anything is made: two events for them at once make
  // one grant and one workspace — the loser re-reads and answers from the winner's grant.
  const claimed = await claimGrant(evt, { access: "workspace", workspaceId: kept, role: "ADMIN" });
  if (!claimed) return activate(evt, origin);
  if (kept) {
    await db.workspace.update({ where: { id: kept }, data: { trialEndsAt: null, heldAt: null, holdReason: null } });
    forgetHold(kept);
    const name = (await liveWorkspace(kept))?.name ?? "their workspace";
    await auditGrant(claimed, "membership.granted", { plan: planLabel, kept: trial ? "trial" : "another plan's workspace" });
    const message = trial
      ? `${planLabel} started; ${member.email}'s free trial workspace ${name} is now a member workspace — the trial's end and allowance no longer apply.`
      : `${planLabel} started; it keeps ${name}, the workspace ${member.email} already has.`;
    return { answer: await withLinks(answer(true, "attached", message), claimed, origin), grantId: claimed.id };
  }
  const ws = await newMemberWorkspace(evt, plan);
  grant = await db.membershipGrant.update({ where: { id: claimed.id }, data: { workspaceId: ws.id } });
  await auditGrant(grant, "membership.granted", { plan: planLabel });
  return { answer: await withLinks(answer(true, "invited", `${planLabel} started: workspace ${ws.name} is ready for ${member.email}.`), grant, origin), grantId: grant.id };
}

async function deactivate(evt: Extract<MembershipCall, { type: "membership.deactivated" }>): Promise<Applied> {
  const { member, membership } = evt;
  const planLabel = membership.name || `membership ${membership.id}`;
  const grant = await findGrant(member.id, membership.id);
  if (!grant) return { answer: answer(true, "ignored", `${planLabel} never gave ${member.email} anything in Publisher, so there is nothing to end.`) };
  if (isStale(grant, evt)) return { answer: answer(true, "stale", "An older event than the last one applied — nothing changed."), grantId: grant.id };
  if (grant.status === "lapsed") {
    await db.membershipGrant.update({ where: { id: grant.id }, data: { lastEventAt: evt.occurredAt } });
    return { answer: answer(true, "unchanged", `${planLabel} had already ended — nothing changed.`), grantId: grant.id };
  }
  const update: Prisma.MembershipGrantUncheckedUpdateInput = { status: "lapsed", lastEventAt: evt.occurredAt };
  // An invitation not yet used can't be used after the plan ended; a return makes a fresh one.
  if (grant.invitationId) {
    await db.invitation.deleteMany({ where: { id: grant.invitationId, acceptedAt: null } });
    update.invitationId = null;
  }
  let message = `${planLabel} ended for ${member.email}.`;
  if (grant.access === "workspace" && grant.workspaceId) {
    // Held only when no other active plan keeps it (an upgrade's old plan ending after the new one began).
    const keeper = await db.membershipGrant.count({ where: { workspaceId: grant.workspaceId, status: "active", id: { not: grant.id } } });
    if (keeper === 0) {
      await db.workspace.updateMany({ where: { id: grant.workspaceId, heldAt: null }, data: { heldAt: new Date(), holdReason: "membership_lapsed" } });
      forgetHold(grant.workspaceId);
      message += " Its workspace is on hold — kept whole, closed to its members, the engine and AI stopped — until a membership starts again.";
    } else {
      message += " Another active plan keeps its workspace going.";
    }
  }
  if (grant.access === "join" && grant.workspaceId) {
    const seat = await db.membership.findFirst({
      where: { workspaceId: grant.workspaceId, status: "active", user: { email: { equals: grant.email, mode: "insensitive" } } },
      include: { user: { select: { email: true } } },
    });
    if (seat && !isPlatformOperator(seat.user.email)) {
      await db.membership.update({ where: { id: seat.id }, data: { status: "revoked" } });
      update.revokedMembershipId = seat.id;
      message += " Their seat was withdrawn; it comes back if the plan does.";
    }
  }
  const saved = await db.membershipGrant.update({ where: { id: grant.id }, data: update });
  await auditGrant(saved, "membership.lapsed", { plan: planLabel });
  return { answer: answer(true, "lapsed", message, { workspace: await workspaceRef(saved.workspaceId) }), grantId: saved.id };
}

async function link(evt: Extract<MembershipCall, { type: "membership.link" }>, origin: string): Promise<Applied> {
  const grants = await db.membershipGrant.findMany({
    where: { source: SOURCE, externalMemberId: evt.member.id, ...(evt.membership ? { externalPlanId: evt.membership.id } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!grants.length) return { answer: answer(true, "ignored", `${evt.member.email} has no Publisher access from meyousocial.com.`, { grants: [], link: null }) };
  const refs = await Promise.all(grants.map((g) => grantRef(g, origin)));
  const first = refs.find((r) => r.status === "active" && r.link) ?? null;
  return {
    answer: answer(true, "linked", first ? `Where ${evt.member.email} goes now.` : `${evt.member.email}'s plans have all ended.`, {
      grants: refs,
      workspace: first?.workspace ?? null,
      link: first?.link ?? null,
    }),
    grantId: grants[0].id,
  };
}

// ── Pieces ──────────────────────────────────────────────────────────────────

async function liveWorkspace(id: string) {
  return db.workspace.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
}

/** A free trial `email` runs as admin, not already kept by a plan — the one a first membership takes over. */
async function ownTrialWorkspace(email: string) {
  return db.workspace.findFirst({
    where: {
      deletedAt: null,
      signupSource: "app",
      trialEndsAt: { not: null },
      membershipGrants: { none: {} },
      memberships: { some: { role: "ADMIN", status: "active", user: { email: { equals: email, mode: "insensitive" } } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

async function newMemberWorkspace(evt: Extract<MembershipCall, { type: "membership.activated" }>, plan: PlanRule | null) {
  const policy = await trialPolicy();
  return createWorkspace({
    name: workspaceNameFor({ company: evt.member.company, name: evt.member.name, email: evt.member.email }),
    source: "website",
    templateId: plan?.templateId || policy.templateId,
    parts: policy.templateParts,
    meta: { plan: evt.membership.name ?? evt.membership.id, member: evt.member.id },
  });
}

/** Claim the member and plan: the new grant, or null when another event for them got there first. */
async function claimGrant(
  evt: Extract<MembershipCall, { type: "membership.activated" }>,
  g: { access: "workspace" | "join"; workspaceId: string | null; role: Role },
): Promise<MembershipGrant | null> {
  const made = await db.membershipGrant.createMany({
    data: [
      {
        source: SOURCE,
        externalMemberId: evt.member.id,
        externalPlanId: evt.membership.id,
        planName: evt.membership.name ?? null,
        email: evt.member.email,
        name: evt.member.name ?? null,
        access: g.access,
        workspaceId: g.workspaceId,
        role: g.role,
        lastEventAt: evt.occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  return made.count === 1 ? findGrant(evt.member.id, evt.membership.id) : null;
}

async function auditGrant(grant: MembershipGrant, action: string, meta: Record<string, unknown>) {
  if (!grant.workspaceId) return;
  await writeAudit({
    workspaceId: grant.workspaceId,
    actorId: null,
    action,
    entityType: "membership_grant",
    entityId: grant.id,
    meta: { source: SOURCE, email: grant.email, member: grant.externalMemberId, planId: grant.externalPlanId, ...meta },
  });
}

async function workspaceRef(id: string | null): Promise<WorkspaceRef | null> {
  if (!id) return null;
  const ws = await db.workspace.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, trialEndsAt: true } });
  if (!ws) return null;
  const hold = await workspaceHold(ws.id);
  return { id: ws.id, name: ws.name, held: hold?.reason ?? null, trialEndsAt: ws.trialEndsAt?.toISOString() ?? null };
}

/**
 * Where the member goes now: already an active member of the workspace → sign in; else their
 * invitation, made (or made again, when the last one expired unused) for 30 days. An invitation
 * that was used but no longer leads in (someone removed them) is not re-issued: sign in.
 */
async function linkFor(grant: MembershipGrant, origin: string): Promise<Link | null> {
  if (grant.status !== "active" || !grant.workspaceId) return null;
  const inside = await db.membership.count({
    where: { workspaceId: grant.workspaceId, status: "active", user: { email: { equals: grant.email, mode: "insensitive" } } },
  });
  if (inside) return { kind: "sign_in", url: `${origin}/signin` };
  const current = grant.invitationId ? await db.invitation.findUnique({ where: { id: grant.invitationId } }) : null;
  if (current?.acceptedAt) return { kind: "sign_in", url: `${origin}/signin` };
  if (current && current.expiresAt.getTime() > Date.now()) {
    return { kind: "claim", url: `${origin}/invitations/${current.token}`, expiresAt: current.expiresAt.toISOString() };
  }
  if (current) await db.invitation.deleteMany({ where: { id: current.id, acceptedAt: null } });
  const invite = await db.invitation.create({
    data: {
      workspaceId: grant.workspaceId,
      email: grant.email,
      role: grant.role,
      token: nanoid(40),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  await db.membershipGrant.update({ where: { id: grant.id }, data: { invitationId: invite.id } });
  return { kind: "claim", url: `${origin}/invitations/${invite.token}`, expiresAt: invite.expiresAt.toISOString() };
}

async function grantRef(grant: MembershipGrant, origin: string): Promise<GrantRef> {
  return {
    plan: { id: grant.externalPlanId, name: grant.planName },
    status: grant.status,
    access: grant.access,
    workspace: await workspaceRef(grant.workspaceId),
    link: await linkFor(grant, origin),
  };
}

async function withLinks(a: Answer, grant: MembershipGrant, origin: string): Promise<Answer> {
  return { ...a, workspace: await workspaceRef(grant.workspaceId), link: await linkFor(grant, origin) };
}
