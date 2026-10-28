"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { noShellSnapshot, shellSnapshot, subscribeShell } from "@/lib/shell-live";

/** The header's notifications bell; its count follows the shell poll (E-SHL-01). */
export function UnreadBell({ initial }: { initial: number }) {
  const live = useSyncExternalStore(subscribeShell, shellSnapshot, noShellSnapshot);
  const unread = live?.unread ?? initial;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center justify-center w-11 h-11 rounded-xl hover:bg-[var(--zebra)] transition-colors"
      title={unread ? `${unread} unread notifications` : "Notifications"}
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell className="w-[21px] h-[21px]" strokeWidth={2.25} />
      {unread > 0 && (
        <span
          className="badge-pop absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-mono font-bold grid place-items-center"
          style={{ background: "var(--brand, #E5482F)", color: "#fff" }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
