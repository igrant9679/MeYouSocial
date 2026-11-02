import { db } from "@/lib/db";
import { isSecretSetting } from "@/lib/keyring";

/**
 * Who changed a dial, and what it was (E-SET-05). `setWorkspaceSetting`
 * calls `recordSettingChange` after every write that changed a value; when a
 * signed-in person caused it, it becomes a `setting.changed` audit row (the
 * key as the entity, the values before and after). The engine's own
 * bookkeeping — check-ins, probes, sync status, snapshots — is never a
 * person's dial and isn't recorded, and a secret's value never is: the row
 * says only that it changed. Function modes are read from their own
 * `governance.mode_set` rows.
 */

const BOOKKEEPING = [/^autopilot:(cycle_status|heartbeat)$/, /^analytics:(unmatched|sync_status)$/, /^autonomy:restore$/, /^wordpress:last_probe$/, /^llm:refusal:/, /^security:rotation_since$/, /:refresh_token$/];
const HIDDEN = /:(refresh_token|client_secret|access_token)$/;

export const isRecordedSetting = (key: string) => !BOOKKEEPING.some((r) => r.test(key));
export const isHiddenSetting = (key: string) => isSecretSetting(key) || HIDDEN.test(key);
const clip = (v: string | null) => (v == null ? null : v.length > 300 ? `${v.slice(0, 300)}…` : v);

// What an unset dial means. Forms write every field on each save, so the first
// save turns "unset" into the explicit default — no change anyone made.
const DEFAULTS: Record<string, string> = {
  "autonomy:full": "false", "blog:auto_seo": "true", "social:autoqueue": "false", "social:evergreen_fill": "false",
  "social:auto_image": "true", "social:autogen": "false", "social:autogen_weekly": "5", "social:autogen_campaign": "",
  "ideas:social_gate": "auto", "social:source": "ideas", "social:require_approval": "false",
};
const effective = (key: string, v: string | null) => (v ?? DEFAULTS[key] ?? "") || (DEFAULTS[key] ?? "");

export async function recordSettingChange(workspaceId: string, key: string, from: string | null, to: string | null): Promise<void> {
  if (!isRecordedSetting(key) || effective(key, from) === effective(key, to)) return;
  let actorId: string | null = null;
  try {
    const { getCurrentUser } = await import("@/lib/acl");
    actorId = (await getCurrentUser())?.id ?? null;
  } catch {
    return; // no request — the engine's sweep, not a person
  }
  if (!actorId) return;
  const { writeAudit } = await import("@/lib/governance");
  await writeAudit({
    workspaceId,
    actorId,
    action: "setting.changed",
    entityType: "setting",
    entityId: key,
    meta: isHiddenSetting(key) ? { key, hidden: true } : { key, from: clip(from), to: clip(to) },
  });
}

/** A stored value in words: on / off / not set, or the value itself (short). */
export function settingValueLabel(v: string | null | undefined): string {
  if (v == null || v === "") return "not set";
  if (v === "true") return "on";
  if (v === "false") return "off";
  return v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

export type DialChange = { by: string; at: Date; from: string | null; to: string | null; hidden: boolean };

async function names(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email ?? "a member"]));
}

/** The latest change to each of `keys`, by whom and from what. */
export async function lastSettingChanges(workspaceId: string, keys: string[]): Promise<Map<string, DialChange>> {
  const rows = await db.auditLog.findMany({ where: { workspaceId, action: "setting.changed", entityId: { in: keys } }, orderBy: { createdAt: "desc" }, take: 400, select: { entityId: true, actorId: true, meta: true, createdAt: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.entityId && !latest.has(r.entityId)) latest.set(r.entityId, r);
  const who = await names(workspaceId, [...latest.values()].map((r) => r.actorId).filter((x): x is string => !!x));
  const out = new Map<string, DialChange>();
  for (const [key, r] of latest) {
    let meta: { from?: string | null; to?: string | null; hidden?: boolean } = {};
    try { meta = JSON.parse(r.meta); } catch { /* keep empty */ }
    out.set(key, { by: (r.actorId && who.get(r.actorId)) || "a former member", at: r.createdAt, from: meta.from ?? null, to: meta.to ?? null, hidden: !!meta.hidden });
  }
  return out;
}

/** The latest mode change for each governed function, with the mode it replaced (the row before it). */
export async function lastModeChanges(workspaceId: string): Promise<Map<string, DialChange>> {
  const rows = await db.auditLog.findMany({ where: { workspaceId, action: "governance.mode_set" }, orderBy: { createdAt: "desc" }, take: 200, select: { actorId: true, meta: true, createdAt: true } });
  const byFn = new Map<string, Array<{ actorId: string | null; mode: string | null; at: Date }>>();
  for (const r of rows) {
    let meta: { function?: string; mode?: string } = {};
    try { meta = JSON.parse(r.meta); } catch { continue; }
    if (!meta.function) continue;
    byFn.set(meta.function, [...(byFn.get(meta.function) ?? []), { actorId: r.actorId, mode: meta.mode ?? null, at: r.createdAt }]);
  }
  const who = await names(workspaceId, [...byFn.values()].map((l) => l[0].actorId).filter((x): x is string => !!x));
  const out = new Map<string, DialChange>();
  for (const [fn, list] of byFn) {
    const [last, prev] = list;
    out.set(fn, { by: last.actorId ? (who.get(last.actorId) ?? "a former member") : "the engine", at: last.at, from: prev?.mode ?? null, to: last.mode, hidden: false });
  }
  return out;
}
