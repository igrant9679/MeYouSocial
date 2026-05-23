import Link from "next/link";
import { Users, Settings, Gauge, BarChart3, Layers } from "lucide-react";
import { requireRole } from "@/lib/acl";

// Admin sub-layout — tab strip across the admin surfaces.

const NAV = [
  { href: "/admin",          label: "Users",       icon: Users,    color: "#E5482F" },
  { href: "/admin/settings", label: "Workspace",   icon: Settings, color: "#2563EB" },
  { href: "/admin/limits",   label: "Soft limits", icon: Gauge,    color: "#D97706" },
  { href: "/admin/usage",    label: "Usage",       icon: BarChart3, color: "#15924B" },
  { href: "/admin/channels", label: "Channels",    icon: Layers,   color: "#6D28D9" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return (
    <div>
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
