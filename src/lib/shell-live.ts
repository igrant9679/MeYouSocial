import type { EngineEvent } from "@/lib/dashboard-data";
import type { StripCounts } from "@/lib/stage-counts";
import type { Heartbeat } from "@/lib/heartbeat-note";

/**
 * The header's live numbers, one store for the page (E-SHL-01). The engine
 * pill, the unread bell and the stage strip's badges each read it; ShellPoll
 * is its one writer — the layout's own server-rendered values when they
 * change, then /api/shell every minute while the tab is visible. Before it,
 * the badges and the bell were rendered with the layout and never moved until
 * something revalidated it.
 *
 * ⚠ Import-free at runtime (types only): it's read by client components.
 */

export type ShellState = {
  paused: boolean;
  autonomous: boolean;
  heartbeat: Heartbeat | null;
  autopilotOff: boolean;
};

export type ShellSnapshot = {
  workspaceId: string;
  events: EngineEvent[];
  state: ShellState;
  unread: number;
  counts: StripCounts;
};

let snapshot: ShellSnapshot | null = null;
const listeners = new Set<() => void>();

export const shellSnapshot = (): ShellSnapshot | null => snapshot;
/** For useSyncExternalStore's server snapshot: nothing live during SSR and hydration. */
export const noShellSnapshot = (): ShellSnapshot | null => null;

export function subscribeShell(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function publishShell(next: ShellSnapshot): void {
  snapshot = next;
  for (const fn of listeners) fn();
}
