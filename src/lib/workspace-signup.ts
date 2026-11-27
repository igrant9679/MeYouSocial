import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { copyFromTemplate, type TemplateCounts, type TemplatePart } from "@/lib/workspace-template";
import { trialPolicy, type TrialPolicy } from "@/lib/trial-policy";

// Creating a workspace from a sign-up (2026-11-26, the owner's "sign up a new workspace from the
// website and from within the app itself"). Two doors, one way a workspace is made:
// - Publisher's own sign-up page, and "Start a free trial" on /onboarding/workspace for someone
//   signed in → `startTrialWorkspace`: a trial on MeYouSocial's keys (lib/trial-policy.ts), one per
//   person, ever; the person is its admin at once.
// - a meyousocial.com membership → lib/membership/process.ts → `createWorkspace` with no trial; the
//   member comes in through an invitation the website shows them (Publisher can't email someone it
//   has never met — app mail has no mailbox on this host).
// Either way the workspace starts from the operator's template (Settings → Sign-ups) and starts
// manual: autonomy never travels (lib/workspace-template.ts).

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 60;

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A workspace name from what was typed or sent: the workspace or company, else "<person>'s workspace". */
export function workspaceNameFor(input: { workspace?: string | null; company?: string | null; name?: string | null; email: string }): string {
  const named = [input.workspace, input.company].map(squash).find((s) => s.length >= WORKSPACE_NAME_MIN);
  if (named) return named.slice(0, WORKSPACE_NAME_MAX).trim();
  const person = squash(input.name) || squash(input.email.split("@")[0]) || "New";
  return `${person.slice(0, WORKSPACE_NAME_MAX - 12).trim()}'s workspace`;
}

/** `base`, or `base (2)`, `base (3)`… — the first no workspace (live or waiting to be purged) has. */
async function freeName(base: string): Promise<string> {
  const taken = new Set(
    (await db.workspace.findMany({ where: { name: { startsWith: base, mode: "insensitive" } }, select: { name: true } })).map((w) => w.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, WORKSPACE_NAME_MAX - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, WORKSPACE_NAME_MAX - 9)} ${Date.now().toString(36)}`;
}

export type SignupSource = "app" | "website";

/**
 * Make a workspace for a sign-up: a free name, where it came from, a trial end when `trialDays`
 * is given, the template's parts when one is set and still live. Audited `workspace.created`.
 * No member is added here — the caller decides who comes in and how.
 */
export async function createWorkspace(opts: {
  name: string;
  source: SignupSource;
  trialDays?: number;
  templateId?: string | null;
  parts?: TemplatePart[];
  actorId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ id: string; name: string; trialEndsAt: Date | null; copied: TemplateCounts | null }> {
  const name = await freeName(opts.name);
  const trialEndsAt = opts.trialDays && opts.trialDays > 0 ? new Date(Date.now() + opts.trialDays * 86_400_000) : null;
  const workspace = await db.workspace.create({ data: { name, signupSource: opts.source, trialEndsAt } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: opts.actorId ?? null,
    action: "workspace.created",
    entityType: "workspace",
    entityId: workspace.id,
    meta: { name, via: opts.source === "app" ? "trial sign-up" : "website membership", trialEndsAt: trialEndsAt?.toISOString() ?? null, ...opts.meta },
  });
  let copied: TemplateCounts | null = null;
  const template = opts.templateId
    ? await db.workspace.findFirst({ where: { id: opts.templateId, deletedAt: null }, select: { id: true, name: true } })
    : null;
  if (template && opts.parts?.length) {
    copied = await copyFromTemplate(template.id, workspace.id, opts.parts);
    await writeAudit({
      workspaceId: workspace.id,
      actorId: opts.actorId ?? null,
      action: "workspace.created_from_template",
      entityType: "workspace",
      entityId: workspace.id,
      meta: { from: template.name, fromId: template.id, parts: opts.parts, copied },
    });
  }
  return { id: workspace.id, name, trialEndsAt, copied };
}

export type TrialRefusal = "off" | "used" | "full";

export const TRIAL_REFUSAL_COPY: Record<TrialRefusal, string> = {
  off: "Free trials aren't open right now. Become a member at meyousocial.com, or ask an admin of your company's workspace to invite you.",
  used: "You've already had a free trial. Become a member at meyousocial.com to keep going.",
  full: "Free trials are full for the moment. Try again tomorrow, or become a member at meyousocial.com.",
};

/** Why a trial can't start now, or null. `userId` when the person already has an account. */
export async function trialRefusal(opts: { userId?: string | null }, policy?: TrialPolicy): Promise<TrialRefusal | null> {
  const p = policy ?? (await trialPolicy());
  if (p.days <= 0) return "off";
  if (opts.userId) {
    const u = await db.user.findUnique({ where: { id: opts.userId }, select: { trialStartedAt: true } });
    if (u?.trialStartedAt) return "used";
  }
  if (p.maxOpen > 0) {
    const open = await db.workspace.count({ where: { deletedAt: null, heldAt: null, trialEndsAt: { gt: new Date() } } });
    if (open >= p.maxOpen) return "full";
  }
  return null;
}

/**
 * Start `userId`'s one free trial: a workspace on the trial's terms with them as its admin. The
 * person's trial is claimed first, atomically, so a double submit makes one workspace.
 */
export async function startTrialWorkspace(
  user: { id: string; email: string; name?: string | null },
  workspaceName: string,
): Promise<{ ok: true; workspaceId: string; name: string; trialEndsAt: Date } | { ok: false; refusal: TrialRefusal }> {
  const policy = await trialPolicy();
  const refusal = await trialRefusal({ userId: user.id }, policy);
  if (refusal) return { ok: false, refusal };
  const claimed = await db.user.updateMany({ where: { id: user.id, trialStartedAt: null }, data: { trialStartedAt: new Date() } });
  if (claimed.count === 0) return { ok: false, refusal: "used" };
  const ws = await createWorkspace({
    name: workspaceNameFor({ workspace: workspaceName, name: user.name, email: user.email }),
    source: "app",
    trialDays: policy.days,
    templateId: policy.templateId,
    parts: policy.templateParts,
    actorId: user.id,
  });
  await db.membership.create({ data: { userId: user.id, workspaceId: ws.id, role: "ADMIN" } });
  await writeAudit({
    workspaceId: ws.id,
    actorId: user.id,
    action: "workspace.trial_started",
    entityType: "workspace",
    entityId: ws.id,
    meta: { days: policy.days, tokenCap: policy.tokenCap, imageCap: policy.imageCap, endsAt: ws.trialEndsAt?.toISOString() },
  });
  return { ok: true, workspaceId: ws.id, name: ws.name, trialEndsAt: ws.trialEndsAt! };
}
