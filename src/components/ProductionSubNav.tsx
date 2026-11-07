"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KanbanSquare, PenLine, Clapperboard, Scissors, Calendar, ListChecks, Film, BookOpen, ImageIcon } from "lucide-react";
import { PRODUCTION_TAB_TIPS } from "@/lib/help-tips";

/**
 * Production's tab strip, with an ACTIVE state (it used to render every tab
 * identically). Lives client-side both for usePathname and because lucide icon
 * components can't cross the server→client props boundary.
 *
 * Native `title` tips, never <WithTip>: this strip is overflow-x-auto, which
 * clips absolutely-positioned children — the documented trap.
 */

const NAV = [
  { href: "/production",              label: "Board",         icon: KanbanSquare, color: "var(--teal)" },
  { href: "/production/writers-room", label: "Writer's Room", icon: PenLine,      color: "var(--blue)" },
  { href: "/production/film-queue",   label: "Film Queue",    icon: Clapperboard, color: "var(--amber)" },
  { href: "/production/edit-bay",     label: "Edit Bay",      icon: Scissors,     color: "var(--violet)" },
  { href: "/production/calendar",     label: "Calendar",      icon: Calendar,     color: "var(--green)" },
  { href: "/production/tasks",        label: "Tasks",         icon: ListChecks,   color: "var(--brand)" },
  { href: "/production/assets",       label: "Assets",        icon: Film,         color: "var(--cyan)" },
  { href: "/production/swipes",       label: "Swipes",        icon: ImageIcon,    color: "var(--pink)" },
  { href: "/production/wiki",         label: "Wiki",          icon: BookOpen,     color: "var(--indigo)" },
];

export function ProductionSubNav() {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) =>
    href === "/production" ? pathname === "/production" || pathname.startsWith("/production/projects") : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex flex-wrap gap-1 mb-5 border-b border-[var(--line)] overflow-x-auto pb-1">
      {NAV.map((n) => {
        const Icon = n.icon;
        const on = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            title={PRODUCTION_TAB_TIPS[n.href]}
            aria-current={on ? "page" : undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono uppercase tracking-wider transition-colors"
            style={on ? { background: "var(--zebra)", color: n.color, fontWeight: 700, boxShadow: `inset 0 -2px 0 ${n.color}` } : { color: "var(--mute)" }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: n.color }} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
