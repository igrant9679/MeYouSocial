"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, Image as ImageIcon, KanbanSquare, Settings, HelpCircle, FileText, Clapperboard } from "lucide-react";

// Client-side left-rail nav. Renders the chip strip and highlights the active
// route via usePathname. Kept tiny so the rest of the app shell can stay server-rendered.

const ICONS = {
  Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, ImageIcon, KanbanSquare, Settings, HelpCircle, FileText, Clapperboard,
} as const;
type IconKey = keyof typeof ICONS;

export type LeftRailItem = {
  href: string;
  label: string;
  icon: IconKey;
  color: string;
  soft: string;
};

// Active-route matcher for the rail. Match exact route OR any nested route under it
// (e.g. /channels/abc → /channels). Special cases:
//  - /dashboard so "/" doesn't match everything.
//  - The "Ideas"/"Scripts" entries point at /ideas|/scripts, but those redirect into
//    /channels/[id]/ideas|scripts. Without this, the /channels prefix would light up
//    "Channels" on those pages. So channel-scoped ideas/scripts win over Channels.
export function isNavActive(href: string, pathname: string): boolean {
  const channelSub = pathname.match(/^\/channels\/[^/]+\/(ideas|scripts)(?:\/|$)/);
  if (channelSub) return href === `/${channelSub[1]}`;
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function LeftRailNav({ items }: { items: LeftRailItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((n) => {
        const Icon = ICONS[n.icon];
        const isActive = isNavActive(n.href, pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive ? "page" : undefined}
            className={
              "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15px] font-semibold min-h-[48px] transition-colors " +
              (isActive ? "text-white" : "text-[var(--slate)] hover:bg-[var(--zebra)]")
            }
            style={isActive ? { background: n.color, boxShadow: `0 4px 12px ${n.color}44` } : undefined}
          >
            <Icon
              className="w-[22px] h-[22px] flex-shrink-0"
              strokeWidth={2.25}
              style={{ color: isActive ? "#ffffff" : n.color }}
            />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
