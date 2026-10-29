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
    case "api_key.saved": return `The ${entityId ?? "API"} key was changed`;
    case "api_key.removed": return `The ${entityId ?? "API"} key was removed`;
    case "api_token.created": return `An API token “${str(meta.name) ?? "unnamed"}” (${meta.scope === "write" ? "read and write" : "read"}) was made`;
    case "api_token.revoked": return `The API token “${str(meta.name) ?? "unnamed"}” was revoked`;
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
