import { db } from "@/lib/db";
import type { Heartbeat } from "@/lib/heartbeat-note";

export { SILENCE_MS, isSilent, heartbeatNote, type Heartbeat } from "@/lib/heartbeat-note";

/**
 * The engine's check-in (E-ENG-03). Every cycle that runs writes one — paused,
 * idle or busy — so "nothing to do" and "not running at all" stop looking the
 * same. Before this an idle cycle wrote nothing: the header and the Inbox could
 * only show the last thing DONE, and a dead sweep read as a quiet week.
 *
 * One WorkspaceSetting row per workspace, written directly (like the cycle
 * status) so the 30 s settings cache never serves a stale check-in.
 */
const KEY = "autopilot:heartbeat";

export async function readHeartbeat(workspaceId: string): Promise<Heartbeat | null> {
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: KEY } } });
  if (!row?.value) return null;
  try {
    const hb = JSON.parse(row.value) as Heartbeat;
    return typeof hb.at === "string" ? hb : null;
  } catch {
    return null;
  }
}

export async function recordHeartbeat(workspaceId: string, hb: Omit<Heartbeat, "at">): Promise<void> {
  const value = JSON.stringify({ at: new Date().toISOString(), ...hb });
  await db.workspaceSetting.upsert({
    where: { workspaceId_key: { workspaceId, key: KEY } },
    update: { value },
    create: { workspaceId, key: KEY, value },
  });
}
