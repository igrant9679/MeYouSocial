"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, Image as ImageIcon, KanbanSquare, Settings, HelpCircle } from "lucide-react";

// Client-side left-rail nav. Renders the chip strip and highlights the active
// route via usePathname. Kept tiny so the rest of the app shell can stay server-rendered.

const ICONS = {
  Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, ImageIcon, KanbanSquare, Settings, HelpCircle,
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
    <>
      {items.map((n) => {
        const Icon = ICONS[n.icon];
        const isActive = isNavActive(n.href, pathname);
        return (
          <Link
            key={n.href}
            href={n.href}
            title={n.label}
            aria-current={isActive ? "page" : undefined}
            className="group relative w-11 h-11 rounded-2xl grid place-items-center transition-all duration-150 hover:scale-105"
            style={{
              background: isActive ? n.color : n.soft,
              color: isActive ? "#ffffff" : n.color,
              boxShadow: isActive ? `0 6px 18px ${n.color}55` : undefined,
            }}
          >
            <Icon className="w-[22px] h-[22px]" strokeWidth={2.25} />
            {/* Active marker — small dot anchor to the left of the chip */}
            {isActive && (
              <span
                aria-hidden
                className="absolute -left-[10px] top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-full"
                style={{ background: n.color }}
              />
            )}
            <span
              className="absolute left-[58px] top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-semibold font-mono px-2.5 py-1 rounded-md text-white shadow-lg opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition pointer-events-none z-50"
              style={{ background: n.color }}
            >
              {n.label}{isActive && " · current"}
            </span>
          </Link>
        );
      })}
    </>
  );
}
