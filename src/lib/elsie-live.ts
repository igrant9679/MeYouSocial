/**
 * How many suggestions Elsie has right now — one number for the page, read by
 * her header button and written by her pane (components/AssistantDock.tsx)
 * each time it asks /api/elsie. The same shape as lib/shell-live.ts.
 *
 * ⚠ Import-free: it's read by client components.
 */

let count = 0;
const listeners = new Set<() => void>();

export const elsieCount = (): number => count;
/** For useSyncExternalStore's server snapshot: nothing known during SSR and hydration. */
export const noElsieCount = (): number => 0;

export function subscribeElsie(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function publishElsieCount(next: number): void {
  if (next === count) return;
  count = next;
  for (const fn of listeners) fn();
}
