"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";

// Channel <select> that submits its enclosing form on change, so switching the
// active channel is one interaction instead of "pick + click Switch". Since
// One-Loop step 6 it lives on the channel pages' own header (the app header
// no longer claims an "active channel"); with `keepSubpath` it fills the
// form's hidden `to` field with the same sub-page on the chosen channel, so
// switching from Voice lands on the other channel's Voice.
export function ChannelSwitcher({
  channels,
  activeId,
  keepSubpath = false,
}: {
  channels: { id: string; name: string }[];
  activeId: string;
  keepSubpath?: boolean;
}) {
  const pathname = usePathname() ?? "";
  return (
    <span className="relative inline-flex items-center">
      <select
        name="channelId"
        defaultValue={activeId}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          if (keepSubpath) {
            const to = form.querySelector<HTMLInputElement>('input[name="to"]');
            if (to) to.value = pathname.replace(/^\/channels\/[^/]+/, `/channels/${e.currentTarget.value}`);
          }
          form.requestSubmit();
        }}
        aria-label="Switch active channel"
        className="appearance-none bg-transparent border-0 pl-1 pr-5 cursor-pointer rounded font-mono text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
      >
        {channels.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-[var(--mute)] pointer-events-none absolute right-0" aria-hidden />
    </span>
  );
}
