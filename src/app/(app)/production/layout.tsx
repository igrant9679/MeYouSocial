import Link from "next/link";
import { KanbanSquare, PenLine, Clapperboard, Scissors, Calendar, ListChecks, Film, BookOpen, ImageIcon } from "lucide-react";
import { requireMembership } from "@/lib/acl";

const NAV = [
  { href: "/production",              label: "Board",         icon: KanbanSquare, color: "#0D9488" },
  { href: "/production/writers-room", label: "Writer's Room", icon: PenLine,      color: "#2563EB" },
  { href: "/production/film-queue",   label: "Film Queue",    icon: Clapperboard, color: "#D97706" },
  { href: "/production/edit-bay",     label: "Edit Bay",      icon: Scissors,     color: "#6D28D9" },
  { href: "/production/calendar",     label: "Calendar",      icon: Calendar,     color: "#15924B" },
  { href: "/production/tasks",        label: "Tasks",         icon: ListChecks,   color: "#E5482F" },
  { href: "/production/assets",       label: "Assets",        icon: Film,         color: "#0891B2" },
  { href: "/production/swipes",       label: "Swipes",        icon: ImageIcon,    color: "#DB2777" },
  { href: "/production/wiki",         label: "Wiki",          icon: BookOpen,     color: "#4F46E5" },
];

export default async function ProductionLayout({ children }: { children: React.ReactNode }) {
  await requireMembership();
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#D7F1ED", color: "#0D9488" }}>
          <KanbanSquare className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Production</h1>
          <p className="text-xs text-[var(--mute)]">Run the channel. Writer's Room → Film Queue → Edit Bay → Calendar.</p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 mb-5 border-b border-[var(--line)] overflow-x-auto pb-1">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href} className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono uppercase tracking-wider text-[var(--mute)] hover:bg-[var(--zebra)]">
              <Icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
