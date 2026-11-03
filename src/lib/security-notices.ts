import { notify } from "@/lib/notify";

/**
 * Security notices (E-SEC-12): every admin hears — in the Inbox's bell, and by
 * email unless they turned it off — about the changes that decide who can do
 * what here: a role changed, an admin added or invited, a key changed or
 * removed, a mailbox or Zernio profile attached, the platform operator coming
 * in. Driven from writeAudit, so every path that records one of these sends
 * it; the person who did it isn't told about their own act.
 */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;
}

export function securityTitle(action: string, entityId: string | null | undefined, meta: Record<string, unknown>): string | null {
  const who = str(meta.email) ?? "A member";
  switch (action) {
    case "membership.role_changed": return `${who} is now ${str(meta.role) ?? "in a different role"}`;
    case "membership.added": return meta.role === "ADMIN" ? `${who} was added as an admin` : null;
    case "membership.invited": return meta.role === "ADMIN" ? `${who} was invited as an admin` : null;
    case "membership.entered": return `The platform operator (${who}) entered this workspace`;
    case "membership.support_view_started": return `The platform operator (${who}) is viewing this workspace read-only, for support${typeof meta.until === "string" ? `, until ${meta.until.slice(11, 16)} UTC` : ""}`;
    case "api_key.saved": return `The ${entityId ?? "API"} key was changed`;
    case "api_key.removed": return `The ${entityId ?? "API"} key was removed`;
    case "api_token.created": return `An API token “${str(meta.name) ?? "unnamed"}” (${meta.scope === "write" ? "read and write" : "read"}) was made`;
    case "api_token.revoked": return `The API token “${str(meta.name) ?? "unnamed"}” was revoked`;
    case "security.access_policy_changed": {
      const d = Array.isArray(meta.domains) && meta.domains.length ? `only ${(meta.domains as string[]).map((x) => `@${x}`).join(", ")}` : "any email domain";
      return `Access rules changed: ${d}; ${meta.googleOnly ? "Google sign-in only" : "passwords allowed"}; ${meta.expireDays ? `idle editors and viewers lose access after ${meta.expireDays} days` : "no automatic expiry"}`;
    }
    case "membership.expired": return `${who} lost access after ${typeof meta.days === "number" ? meta.days : "too many"} days without signing in`;
    case "workspace.deleted": return `This workspace was deleted by ${meta.via === "platform" ? "the platform operator" : "one of its admins"} — it's kept until ${typeof meta.purgeAfter === "string" ? meta.purgeAfter.slice(0, 10) : "the end of its restore window"}, then purged; the platform operator can restore it until then`;
    case "workspace.restored": return "The platform operator restored this workspace";
    case "security.incident_declared": return `The platform operator declared a security incident: ${str(meta.note) ?? "no details given"}`;
    case "security.incident_ended": return "The platform operator ended the security incident";
    case "security.2fa_disabled": return `${who} turned off two-factor sign-in`;
    // E-SHL-09: a sign-in address moved, or an account deleted itself — either can be a takeover's last step.
    case "account.email_changed": return `${who} changed their sign-in email to ${str(meta.to) ?? "a new address"}`;
    case "account.deleted": return `${who} deleted their account`;
    case "security.2fa_reset": return `The platform operator turned off two-factor sign-in for ${who}`;
    case "security.2fa_requirement_changed": return meta.required ? "Two-factor sign-in is now required for admins" : "Two-factor sign-in is no longer required for admins";
    case "integration.adopted":
      return meta.kind === "mailbox" ? `A mailbox (${str(meta.address) ?? "unnamed"}) was attached to this workspace` : "A Zernio profile was attached to this workspace";
    default: return null;
  }
}

export async function sendSecurityNotice(p: { workspaceId: string; actorId?: string | null; action: string; entityId?: string | null; meta?: Record<string, unknown> }): Promise<void> {
  const title = securityTitle(p.action, p.entityId, p.meta ?? {});
  if (!title) return;
  await notify({
    workspaceId: p.workspaceId,
    kind: "security",
    title,
    body: "If you didn't expect this, look at Settings → People and Keys, and the audit log.",
    path: "/admin/audit-log",
    entityType: "security",
    entityId: p.entityId ?? null,
    excludeUserId: p.actorId ?? null,
  });
}
