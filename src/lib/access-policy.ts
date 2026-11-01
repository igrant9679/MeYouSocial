import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { env } from "@/lib/env";

/**
 * Who may join a workspace and how its people sign in (E-SEC-08, E-SEC-18).
 *
 *   allowed domains  — invitations and new members only at these email domains
 *                      (People → "Only these domains"); existing members outside
 *                      them are flagged, never removed.
 *   Google sign-in   — when the install has Google SSO on, a workspace can make
 *                      its members sign in with Google instead of a password
 *                      (the password path refuses them; the operator is exempt,
 *                      as the way back in).
 *   auto-expiry      — editors and viewers idle for N days lose access (revoked,
 *                      history kept); admins are never expired, so a workspace
 *                      can't lock itself out. Off unless chosen.
 */

export const DOMAINS_SETTING = "security:allowed_domains";
export const GOOGLE_ONLY_SETTING = "security:require_google_signin";
export const EXPIRE_SETTING = "security:auto_expire_days";
export const EXPIRE_CHOICES = [0, 60, 90, 180] as const;

/** "Acme.com, @acme.co.uk" → ["acme.com", "acme.co.uk"]; anything that isn't a domain is dropped. */
export function parseDomains(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)))].slice(0, 20);
}

export async function allowedDomains(workspaceId: string): Promise<string[]> {
  return parseDomains(await getSetting(DOMAINS_SETTING, workspaceId));
}

export function domainOf(email: string): string {
  return email.trim().toLowerCase().split("@").pop() ?? "";
}

/** Null when `email` may join; otherwise the sentence to show. */
export async function joinRefusal(workspaceId: string, email: string): Promise<string | null> {
  const domains = await allowedDomains(workspaceId);
  if (!domains.length || domains.includes(domainOf(email))) return null;
  return `This workspace only takes people at ${domains.map((d) => `@${d}`).join(", ")} — change that under Settings → People.`;
}

export function googleSsoAvailable(): boolean {
  return Boolean(env.ENABLE_GOOGLE_SSO && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Must this person sign in with Google? Yes when the install has Google SSO and
 * a live workspace they're an active member of requires it. Never the operator.
 */
export async function mustUseGoogle(user: { id: string; email: string }): Promise<boolean> {
  if (!googleSsoAvailable()) return false;
  if (env.BOOTSTRAP_ADMIN_EMAIL && user.email.trim().toLowerCase() === env.BOOTSTRAP_ADMIN_EMAIL) return false;
  const ms = await db.membership.findMany({ where: { userId: user.id, status: "active", workspace: { deletedAt: null } }, select: { workspaceId: true } });
  for (const m of ms) if ((await getSetting(GOOGLE_ONLY_SETTING, m.workspaceId)) === "true") return true;
  return false;
}

/**
 * The expiry sweep: in every live workspace that chose a period, active editors
 * and viewers not seen for that long are revoked — from their last activity, or
 * from joining if they never came. Audited per person (which tells the admins).
 */
export async function expireIdleMembers(now = new Date()): Promise<number> {
  const rows = await db.workspaceSetting.findMany({ where: { key: EXPIRE_SETTING, workspace: { deletedAt: null } }, select: { workspaceId: true, value: true } });
  let n = 0;
  for (const r of rows) {
    const days = Number(r.value);
    if (!EXPIRE_CHOICES.includes(days as (typeof EXPIRE_CHOICES)[number]) || days <= 0) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const stale = await db.membership.findMany({
      where: {
        workspaceId: r.workspaceId, status: "active", role: { not: "ADMIN" }, createdAt: { lt: cutoff },
        user: { OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null }] },
      },
      select: { id: true, userId: true, role: true, user: { select: { email: true, lastActivityAt: true } } },
    });
    const { writeAudit } = await import("@/lib/governance");
    for (const m of stale) {
      if (env.BOOTSTRAP_ADMIN_EMAIL && m.user.email.toLowerCase() === env.BOOTSTRAP_ADMIN_EMAIL) continue;
      const done = await db.membership.updateMany({ where: { id: m.id, status: "active" }, data: { status: "revoked" } });
      if (!done.count) continue;
      n++;
      await writeAudit({
        workspaceId: r.workspaceId, actorId: null, action: "membership.expired", entityType: "membership", entityId: m.id,
        meta: { email: m.user.email, role: m.role, days, lastActivityAt: m.user.lastActivityAt?.toISOString() ?? null },
      });
    }
  }
  return n;
}
