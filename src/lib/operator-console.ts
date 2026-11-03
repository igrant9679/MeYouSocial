import { db } from "@/lib/db";
import { stripCounts } from "@/lib/stage-counts";
import { readHeartbeat, isSilent, heartbeatNote } from "@/lib/engine-heartbeat";
import { readSyncStatus, SOURCE_LABEL } from "@/lib/analytics/sync";
import { lastProbe } from "@/lib/wp-health";
import { connectionRows } from "@/lib/setup-status";

/**
 * The operator console (E-SHL-15): every tenant on one page — what needs a
 * person there, whether the engine is checking in, whether analytics and the
 * website answer, what's not connected and whose keys the rest run on, what's
 * failing, and when anyone was last there. Each column reads the helper the
 * tenant's own page reads, so the console and the workspace never disagree.
 *
 * Read-only, and it never calls a provider: every figure is a stored status
 * (the heartbeat, the last sync, the last WordPress probe, account states).
 */

export type Health = "ok" | "warn" | "bad" | "none";

export type ConsoleRow = {
  id: string;
  name: string;
  members: number;
  admins: number;
  needsYou: number;
  engine: { health: Health; line: string };
  analytics: { health: Health; line: string };
  website: { health: Health; line: string };
  missing: string[];
  keys: { own: string[]; platform: string[]; env: string[] };
  failing: string[];
  lastActivity: Date | null;
};

const ago = (iso: string | Date, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export async function consoleRow(ws: { id: string; name: string }, now = Date.now()): Promise<ConsoleRow> {
  const since = new Date(now - 7 * 86_400_000);
  const [members, counts, hb, sync, probe, conns, accounts, notices] = await Promise.all([
    db.membership.findMany({ where: { workspaceId: ws.id, status: "active" }, select: { role: true, user: { select: { lastActivityAt: true } } } }),
    stripCounts(ws.id).catch(() => ({} as Record<string, { n: number; urgent?: boolean }>)),
    readHeartbeat(ws.id).catch(() => null),
    readSyncStatus(ws.id).catch(() => ({})),
    lastProbe(ws.id).catch(() => null),
    connectionRows(ws.id).catch(() => []),
    db.zernioAccount.findMany({ where: { workspaceId: ws.id, status: { not: "connected" } }, select: { platform: true, username: true, status: true } }).catch(() => []),
    db.notification.findMany({ where: { workspaceId: ws.id, kind: { in: ["publish_failed", "account_broken"] }, createdAt: { gte: since } }, select: { title: true }, distinct: ["title"], take: 5 }),
  ]);

  const engine: ConsoleRow["engine"] = !hb
    ? { health: "none", line: "never checked in" }
    : hb.skipped === "paused"
      ? { health: "warn", line: `paused · ${ago(hb.at, now)}` }
      : isSilent(hb, now)
        ? { health: "bad", line: `silent since ${ago(hb.at, now)}` }
        : { health: hb.failed ? "warn" : "ok", line: `${ago(hb.at, now)} — ${heartbeatNote(hb)}` };

  const sources = Object.entries(sync) as Array<[keyof typeof SOURCE_LABEL, { ok: boolean; message: string; at: string; failures: number }]>;
  const analytics: ConsoleRow["analytics"] = !sources.length
    ? { health: "none", line: "not syncing" }
    : sources.some(([, s]) => !s.ok)
      ? { health: "bad", line: sources.filter(([, s]) => !s.ok).map(([k, s]) => `${SOURCE_LABEL[k] ?? k}: ${s.message}`.slice(0, 120)).join(" · ") }
      : { health: "ok", line: `synced ${ago(sources.map(([, s]) => s.at).sort().pop()!, now)}` };

  const website: ConsoleRow["website"] = !probe
    ? { health: "none", line: "no WordPress" }
    : probe.ok
      ? { health: "ok", line: `answered ${ago(probe.at, now)}` }
      : { health: probe.fails >= 2 ? "bad" : "warn", line: probe.detail.slice(0, 120) };

  const keys = { own: [] as string[], platform: [] as string[], env: [] as string[] };
  for (const c of conns) {
    if (c.state !== "ok" || !c.source) continue;
    if (/workspace/.test(c.source)) keys.own.push(c.label);
    else if (/platform/.test(c.source)) keys.platform.push(c.label);
    else if (/environment/.test(c.source)) keys.env.push(c.label);
  }

  const lastActivity = members.map((m) => m.user.lastActivityAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    id: ws.id,
    name: ws.name,
    members: members.length,
    admins: members.filter((m) => m.role === "ADMIN").length,
    needsYou: Object.values(counts).reduce((n, c) => n + (c.urgent ? c.n : 0), 0),
    engine,
    analytics,
    website,
    missing: conns.filter((c) => c.required && c.state !== "ok").map((c) => c.label),
    keys,
    failing: [
      ...accounts.map((a) => `${a.platform}${a.username ? ` @${a.username}` : ""} ${a.status}`),
      ...notices.map((n) => n.title),
    ],
    lastActivity,
  };
}

export async function operatorConsole(now = Date.now()): Promise<ConsoleRow[]> {
  const workspaces = await db.workspace.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return Promise.all(workspaces.map((w) => consoleRow(w, now)));
}
