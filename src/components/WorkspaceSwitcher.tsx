"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

// Workspace <select> for users who belong to more than one company. Submits
// its enclosing server-action form on change — same pattern as ChannelSwitcher.
// Each other workspace says what needs this person there and their unread
// notifications, and switching keeps the section being looked at (E-SHL-05).
//
// The platform operator (super admin) also gets a "New workspace" entry. It is
// NOT a workspace value: choosing it navigates rather than submitting, so the
// switch action never receives an id it would reject. `canCreate` only decides
// whether the option is OFFERED — `createWorkspaceAction` re-checks the
// operator server-side, which is the actual boundary.

const NEW_WORKSPACE = "__new_workspace__";

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  canCreate = false,
}: {
  workspaces: { id: string; name: string; badge?: { needsYou: number; unread: number } | null }[];
  activeId: string;
  canCreate?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const label = (w: (typeof workspaces)[number]) => {
    const parts = [w.badge?.needsYou ? `${w.badge.needsYou} need${w.badge.needsYou === 1 ? "s" : ""} you` : null, w.badge?.unread ? `${w.badge.unread} unread` : null].filter(Boolean);
    return parts.length ? `${w.name} — ${parts.join(" · ")}` : w.name;
  };
  const elsewhere = workspaces.filter((w) => w.id !== activeId).reduce((n, w) => n + (w.badge?.needsYou ?? 0) + (w.badge?.unread ?? 0), 0);

  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="hidden" name="back" value={pathname ?? ""} />
      <span className="relative inline-flex items-center" title="Switch workspace">
        <select
          name="workspaceId"
          defaultValue={activeId}
          onChange={(e) => {
            if (e.currentTarget.value === NEW_WORKSPACE) {
              // Restore the real selection before navigating, so coming back
              // (browser back) doesn't leave "+ New workspace…" showing as the
              // current workspace.
              e.currentTarget.value = activeId;
              router.push("/onboarding/workspace");
              return;
            }
            e.currentTarget.form?.requestSubmit();
          }}
          aria-label="Switch workspace"
          className="appearance-none bg-transparent border-0 pl-1 pr-5 cursor-pointer rounded font-mono text-[15px] font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 max-w-[200px] truncate [field-sizing:content]"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.id === activeId ? w.name : label(w)}</option>
          ))}
          {canCreate && (
            // Grouped and labelled so it reads as an action, not another company.
            <optgroup label="Platform admin">
              <option value={NEW_WORKSPACE}>+ New workspace…</option>
            </optgroup>
          )}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--mute)] pointer-events-none absolute right-0" aria-hidden />
      </span>
      {elsewhere > 0 && (
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} title="Waiting for you in your other workspaces — open the list to see where" data-elsewhere>
          {elsewhere} elsewhere
        </span>
      )}
    </span>
  );
}
