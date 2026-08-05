"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Settings, Gauge, BarChart3, Layers, KeyRound, Mail, Plug, LineChart, Building2 } from "lucide-react";

/**
 * Admin's tab strip, with an ACTIVE state (like Production's, it used to
 * render every tab identically). Client-side for usePathname; icons stay
 * local because they can't cross the server→client props boundary.
 */

const NAV = [
  { href: "/admin",            label: "Users",       icon: Users,    color: "#E5482F" },
  { href: "/admin/settings",   label: "Workspace",   icon: Settings, color: "#2563EB" },
  { href: "/admin/connections",label: "Connections", icon: Plug,     color: "#7C3AED" },
  { href: "/admin/limits",     label: "Soft limits", icon: Gauge,    color: "#D97706" },
  { href: "/admin/usage",      label: "Usage",       icon: BarChart3, color: "#15924B" },
  { href: "/admin/channels",   label: "Channels",    icon: Layers,   color: "#6D28D9" },
  { href: "/admin/api-keys",   label: "API keys",    icon: KeyRound, color: "#D97706" },
  { href: "/admin/analytics",  label: "Analytics",   icon: LineChart, color: "#15924B" },
  { href: "/admin/email",      label: "Email/SMTP",  icon: Mail,     color: "#0891B2" },
];

// Platform-operator-only tab — appended when the server layout says so. Kept
// out of NAV so a tenant admin never sees a tab that only 403s for them.
const OPERATOR_NAV = [
  { href: "/admin/workspaces", label: "Workspaces",  icon: Building2, color: "#7C3AED" },
];

export function AdminSubNav({ operator = false }: { operator?: boolean }) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");
  const tabs = operator ? [...NAV, ...OPERATOR_NAV] : NAV;

  return (
    <nav className="flex flex-wrap gap-1 mb-5 border-b border-[var(--line)] overflow-x-auto pb-1">
      {tabs.map((n) => {
        const Icon = n.icon;
        const on = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
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
