"use client";

import { ChevronDown } from "lucide-react";

// Workspace <select> for users who belong to more than one company. Submits
// its enclosing server-action form on change — same pattern as ChannelSwitcher.
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: { id: string; name: string }[];
  activeId: string;
}) {
  return (
    <span className="relative inline-flex items-center" title="Switch workspace">
      <select
        name="workspaceId"
        defaultValue={activeId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Switch workspace"
        className="appearance-none bg-transparent border-0 pl-1 pr-5 cursor-pointer rounded font-mono text-[15px] font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 max-w-[200px] truncate"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-[var(--mute)] pointer-events-none absolute right-0" aria-hidden />
    </span>
  );
}
