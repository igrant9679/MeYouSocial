"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Sparkles, PenLine, Share2, Menu } from "lucide-react";
import { isNavActive } from "@/components/LeftRailNav";
import { noShellSnapshot, shellSnapshot, subscribeShell } from "@/lib/shell-live";
import type { StripCounts } from "@/lib/stage-counts";

/**
 * The phone's bottom tabs (E-SHL-10): the four places a person works from
 * every day — Inbox, Ideas, Drafts, Distribute — a thumb away, with the
 * strip's own badges (the shell's one poll keeps them fresh), and More for the
 * rest (it opens the drawer). Phones only (`md:hidden`); a person can turn
 * it off from the drawer, and the layout then drops the space kept for it.
 */
const TABS = [
  { href: "/inbox", label: "Inbox", Icon: Inbox, badge: [] as string[] },
  { href: "/ideas", label: "Ideas", Icon: Sparkles, badge: ["/ideas"] },
  { href: "/drafts", label: "Drafts", Icon: PenLine, badge: ["/blog"] },
  { href: "/distribute", label: "Distribute", Icon: Share2, badge: ["/social/approvals", "/social/engage"] },
];

export function MobileTabBar({ counts: initial }: { counts: StripCounts }) {
  const pathname = usePathname() ?? "";
  const live = useSyncExternalStore(subscribeShell, shellSnapshot, noShellSnapshot);
  const counts = live?.counts ?? initial;
  return (
    <nav aria-label="Main sections" data-mobile-tabs className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--line)] bg-[var(--bg)] grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ href, label, Icon, badge }) => {
        const active = isNavActive(href, pathname);
        const n = badge.reduce((sum, k) => sum + (counts[k]?.n ?? 0), 0);
        const urgent = badge.some((k) => counts[k]?.urgent && (counts[k]?.n ?? 0) > 0);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} data-tab={label}
            className="relative flex flex-col items-center justify-center gap-0.5 h-14 text-micro font-semibold"
            style={{ color: active ? "var(--accent-on)" : "var(--mute)" }}>
            <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
            {label}
            {n > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full text-micro font-mono font-bold grid place-items-center"
                style={urgent ? { background: "var(--rose)", color: "white" } : { background: "var(--line-2)", color: "var(--ink)" }} data-tab-badge={n}>
                {n > 99 ? "99+" : n}
              </span>
            )}
          </Link>
        );
      })}
      <button type="button" onClick={() => window.dispatchEvent(new Event("mobilenav:open"))}
        className="flex flex-col items-center justify-center gap-0.5 h-14 text-micro font-semibold text-[var(--mute)]" data-tab="More">
        <Menu className="w-5 h-5" strokeWidth={2} />
        More
      </button>
    </nav>
  );
}
