"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, Image as ImageIcon, KanbanSquare, Settings, HelpCircle, FileText, Clapperboard, FileBarChart, Share2, Palette, LineChart, ChevronRight } from "lucide-react";
import { WithTip } from "@/components/HelpTip";
import { NAV_TIPS } from "@/lib/help-tips";

// Client-side left-rail nav. Renders the chip strip and highlights the active
// route via usePathname. Kept tiny so the rest of the app shell can stay server-rendered.
//
// Since 2026-08-10 the rail is GROUPED BY WORKFLOW STAGE (Research → Create →
// Distribute → Measure → Setup) instead of listing ~16 modules flat — the
// user's word for the flat rail was "overwhelming". Groups collapse; the group
// holding the active route opens itself. Every href is unchanged: this is a
// re-grouping, not a re-routing.
//
// ⚠ Collapse is a WIDE-RAIL affordance only. The narrow (icon-only) rail shows
// every icon exactly as before — headers have no room at 68px, and hiding
// icons behind an invisible header would just be a maze with extra steps.
//
// ⚠ THE ELSIE BRIDGE: tours anchor to nav items (`data-elsie="nav/<href>"`),
// and a collapsed item is display:none — getBoundingClientRect() returns an
// all-zero box and the spotlight would point confidently at the viewport
// corner. Elsie dispatches `elsie:reveal` with the anchor key before it
// measures; we listen and expand the owning group. Her delayed re-measure
// (60ms after step entry) then sees the expanded layout.

const ICONS = {
  Home, Layers, Telescope, Sparkles, PenLine, MessageCircle, ImageIcon, KanbanSquare, Settings, HelpCircle, FileText, Clapperboard, FileBarChart, Share2, Palette, LineChart,
} as const;
type IconKey = keyof typeof ICONS;

export type LeftRailItem = {
  href: string;
  label: string;
  icon: IconKey;
  color: string;
  soft: string;
  /** Workflow-stage group. Absent = ungrouped, always visible (Home, Help). */
  group?: string;
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

/** Ungrouped items and groups, in first-appearance order. */
function sequence(items: LeftRailItem[]): Array<{ group: string; items: LeftRailItem[] } | { group: null; item: LeftRailItem }> {
  const out: Array<{ group: string; items: LeftRailItem[] } | { group: null; item: LeftRailItem }> = [];
  for (const it of items) {
    if (!it.group) {
      out.push({ group: null, item: it });
      continue;
    }
    const last = out[out.length - 1];
    if (last && "items" in last && last.group === it.group) last.items.push(it);
    else out.push({ group: it.group, items: [it] });
  }
  return out;
}

export function LeftRailNav({ items }: { items: LeftRailItem[] }) {
  const pathname = usePathname() ?? "";
  // Manual toggles override the default (only the active group open). Keyed by
  // group name; absence = follow the active route.
  const [manual, setManual] = useState<Record<string, boolean>>({});

  const activeGroup = items.find((n) => isNavActive(n.href, pathname))?.group ?? null;
  const isOpen = (g: string) => manual[g] ?? g === activeGroup;

  // The Elsie bridge — see the header note.
  useEffect(() => {
    const reveal = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (typeof key !== "string" || !key.startsWith("nav/")) return;
      const item = items.find((n) => `nav${n.href}` === key);
      if (item?.group) setManual((m) => ({ ...m, [item.group!]: true }));
    };
    window.addEventListener("elsie:reveal", reveal);
    return () => window.removeEventListener("elsie:reveal", reveal);
  }, [items]);

  const renderItem = (n: LeftRailItem, hiddenWide: boolean) => {
    const Icon = ICONS[n.icon];
    const isActive = isNavActive(n.href, pathname);
    const tip = NAV_TIPS[n.href];
    const link = (
      <Link
        key={n.href}
        href={n.href}
        // Anchor for the Elsie guide — generic, so adding a nav item makes
        // it targetable without touching the tour engine.
        data-elsie={`nav${n.href}`}
        aria-current={isActive ? "page" : undefined}
        className={
          // justify-center + hidden label = icon-only mode when the shell
          // container is narrow (rail collapse; see (app)/layout.tsx).
          // `hiddenWide` = this item's group is folded: gone from the wide
          // rail, still present as an icon in the narrow one.
          "group flex items-center justify-center @6xl:justify-start gap-3 px-2 @6xl:px-3.5 py-2.5 rounded-xl text-[15px] font-semibold min-h-[48px] transition-colors " +
          (hiddenWide ? "@6xl:hidden " : "") +
          (isActive ? "text-white" : "text-[var(--slate)] hover:bg-[var(--zebra)]")
        }
        style={isActive ? { background: n.color, boxShadow: `0 4px 12px ${n.color}44` } : undefined}
      >
        <Icon
          className="w-[22px] h-[22px] flex-shrink-0 transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:scale-110 motion-reduce:transform-none"
          strokeWidth={2.25}
          style={{ color: isActive ? "#ffffff" : n.color }}
        />
        <span className="hidden @6xl:inline">{n.label}</span>
      </Link>
    );
    // The label leads the bubble because the rail collapses to icons on a
    // narrow shell — in that mode this tooltip is the only place the name
    // appears at all, which is what the old `title` was doing.
    return tip ? (
      <WithTip key={n.href} text={`${n.label} — ${tip}`} side="right" wide block>
        {link}
      </WithTip>
    ) : (
      link
    );
  };

  return (
    <nav className="flex flex-col gap-0.5">
      {sequence(items).map((entry) =>
        entry.group === null ? (
          renderItem(entry.item, false)
        ) : (
          <div key={entry.group} className="flex flex-col gap-0.5">
            {/* Header exists only where there's room for words. On the narrow
                rail the group is just a wordless run of icons, as before. */}
            <button
              type="button"
              onClick={() => setManual((m) => ({ ...m, [entry.group]: !isOpen(entry.group) }))}
              aria-expanded={isOpen(entry.group)}
              className="hidden @6xl:flex items-center gap-1 px-3.5 pt-3 pb-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--mute)] hover:text-[var(--slate)] transition-colors select-none"
            >
              <ChevronRight
                className={"w-3 h-3 transition-transform " + (isOpen(entry.group) ? "rotate-90" : "")}
                strokeWidth={2.5}
                aria-hidden
              />
              {entry.group}
              {/* When folded, say what's inside — count, plus a dot if the
                  active page is hiding in there (possible mid-navigation). */}
              {!isOpen(entry.group) && (
                <span className="ml-auto font-normal text-[9px]">{entry.items.length}</span>
              )}
            </button>
            {entry.items.map((n) => renderItem(n, !isOpen(entry.group)))}
          </div>
        ),
      )}
    </nav>
  );
}
