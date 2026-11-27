import type { Role } from "@prisma/client";
import { getSetting, setPlatformSetting } from "@/lib/settings";

// What each meyousocial.com membership gives in Publisher (2026-11-26), set by the operator on
// Settings → Sign-ups and keyed by the MemberPress membership id the website sends. A plan nobody
// mapped gives nothing: its events are logged as "ignored" and can be processed again once it is.
//   none      — logged, nothing given (a forum-only plan, say)
//   workspace — the member's own workspace, with them as its admin (their trial's, if they had one)
//   join      — a seat in a workspace the operator names, with a role

export const PLANS_KEY = "membership:plans";

export type PlanAccess = "none" | "workspace" | "join";
export const PLAN_ACCESS: readonly PlanAccess[] = ["none", "workspace", "join"];
export const PLAN_ACCESS_LABEL: Record<PlanAccess, string> = {
  none: "Nothing in Publisher",
  workspace: "Their own workspace (they're its admin)",
  join: "A seat in a workspace you choose",
};

export type PlanRule = {
  /** The MemberPress membership id. */
  id: string;
  label: string;
  access: PlanAccess;
  /** join: the workspace they get a seat in. */
  workspaceId?: string | null;
  /** join: the seat's role. */
  role?: Role;
  /** workspace: a template other than Sign-ups' default. */
  templateId?: string | null;
};

const ROLES: readonly Role[] = ["ADMIN", "EDITOR", "VIEWER"];

/** Pure: the stored mapping, cleaned — unreadable rows dropped, ids unique (the last wins). */
export function parsePlans(raw: string): PlanRule[] {
  let rows: unknown;
  try {
    rows = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, PlanRule>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" || typeof o.id === "number" ? String(o.id).trim() : "";
    if (!id || id.length > 64) continue;
    const access = PLAN_ACCESS.includes(o.access as PlanAccess) ? (o.access as PlanAccess) : "none";
    const rule: PlanRule = { id, label: typeof o.label === "string" ? o.label.trim().slice(0, 80) : "", access };
    if (access === "join") {
      rule.workspaceId = typeof o.workspaceId === "string" && o.workspaceId ? o.workspaceId : null;
      rule.role = ROLES.includes(o.role as Role) ? (o.role as Role) : "EDITOR";
    }
    if (access === "workspace") rule.templateId = typeof o.templateId === "string" && o.templateId ? o.templateId : null;
    byId.set(id, rule);
  }
  return [...byId.values()];
}

export async function readPlans(): Promise<PlanRule[]> {
  return parsePlans(await getSetting(PLANS_KEY));
}

export async function planFor(id: string): Promise<PlanRule | null> {
  return (await readPlans()).find((p) => p.id === id) ?? null;
}

export async function savePlans(rules: PlanRule[]): Promise<void> {
  await setPlatformSetting(PLANS_KEY, rules.length ? JSON.stringify(parsePlans(JSON.stringify(rules))) : "");
}
