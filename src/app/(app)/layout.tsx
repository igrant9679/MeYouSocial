import Link from "next/link";
import { Bell, LogOut, Layers, User } from "lucide-react";
import { unreadCount } from "@/lib/notify";
import { BrandLogo } from "@/components/BrandLogo";
import { LiveTicker } from "@/components/LiveTicker";
import { tickerEvents } from "@/lib/dashboard-data";
import { signOut } from "@/auth";
import { getActiveChannel } from "@/lib/channel";
import { setActiveChannelAction } from "@/app/actions/channel";
import { LeftRailNav, type LeftRailItem } from "@/components/LeftRailNav";
import { MobileNav } from "@/components/MobileNav";
import { ChannelSwitcher } from "@/components/ChannelSwitcher";

// Each nav item carries its own brand color so the rail reads as a vibrant chip strip
// (mirrors the CreateUp_Mockups.html per-module accent palette).
const NAV: (LeftRailItem & { adminOnly?: boolean })[] = [
  { href: "/dashboard",   label: "Home",        icon: "Home",          color: "#E5482F", soft: "#FDE7E1" },
  { href: "/channels",    label: "Channels",    icon: "Layers",        color: "#7C3AED", soft: "#EEE7FC" },
  { href: "/intel",       label: "Intel",       icon: "Telescope",     color: "#2563EB", soft: "#E5EDFD" },
  { href: "/ideas",       label: "Ideas",       icon: "Sparkles",      color: "#D97706", soft: "#FBEED5" },
  { href: "/scripts",     label: "Scripts",     icon: "PenLine",       color: "#15924B", soft: "#E0F2E8" },
  { href: "/blog",        label: "Blog",        icon: "FileText",      color: "#E11D48", soft: "#FBDFE6" },
  { href: "/reports",     label: "Reports",     icon: "FileBarChart",  color: "#4F46E5", soft: "#E7E6FB" },
  { href: "/videos",      label: "Videos",      icon: "Clapperboard",  color: "#7C3AED", soft: "#EEE7FC" },
  { href: "/chat",        label: "Chat",        icon: "MessageCircle", color: "#6D28D9", soft: "#EDE7FB" },
  { href: "/thumbnails",  label: "Thumbnails",  icon: "ImageIcon",     color: "#DB2777", soft: "#FBE2EF" },
  { href: "/production",  label: "Production",  icon: "KanbanSquare",  color: "#0D9488", soft: "#D7F1ED" },
  { href: "/help",        label: "Help",        icon: "HelpCircle",    color: "#0891B2", soft: "#D8EFF5" },
  { href: "/admin",       label: "Admin",       icon: "Settings",      color: "#4F46E5", soft: "#E7E6FB", adminOnly: true },
];

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, membership, channels, active } = await getActiveChannel();
  const userLabel = user.name ?? user.email.split("@")[0];
  const navItems = NAV.filter((n) => !n.adminOnly || membership.role === "ADMIN");
  const [unread, ticker] = await Promise.all([
    unreadCount(workspace.id, user.id),
    tickerEvents(workspace.id, 12),
  ]);

  return (
    <div className="flex-1 flex min-h-screen">
      <aside className="w-64 left-rail border-r border-[var(--line)] hidden md:flex flex-col gap-1 py-4 px-3 flex-shrink-0 relative z-40">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-2 py-1.5 mb-2 rounded-xl"
          title="MeYouSocial · Home"
        >
          <span className="flex-shrink-0 shadow-lg shadow-[#15181D]/25 rounded-xl">
            <BrandLogo size={38} />
          </span>
          <span className="font-mono font-bold text-[17px] tracking-tight">MeYouSocial</span>
        </Link>

        <LeftRailNav items={navItems} />

        {/* Profile + sign out */}
        <div className="mt-auto flex flex-col gap-1 pt-2 border-t border-[var(--line)]">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--slate)] hover:bg-[var(--zebra)] transition-colors"
            aria-label={`Open ${userLabel}'s settings`}
          >
            <span
              className="w-7 h-7 rounded-lg text-white grid place-items-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#E5482F,#6D28D9)" }}
              aria-hidden
            >
              <User className="w-[16px] h-[16px]" strokeWidth={2.25} />
            </span>
            <span className="truncate">{userLabel}</span>
          </Link>
          <form action={signOutAction}>
            <button
              title="Sign out"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--mute)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)] transition-colors"
            >
              <LogOut className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={2.25} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="min-h-[60px] border-b border-[var(--line)] app-header flex items-center gap-2 md:gap-3 px-3 md:px-6 py-2 flex-shrink-0 flex-wrap">
          <div className="md:hidden">
            <MobileNav items={navItems} userLabel={userLabel} signOutAction={signOutAction} />
          </div>
          <Link href="/channels" className="font-mono font-bold text-[15px] tracking-tight hover:text-[var(--accent)] transition truncate max-w-[40vw] md:max-w-none" title="Manage workspace channels">
            {workspace.name}
          </Link>
          {active && (
            <form action={setActiveChannelAction}>
              <ChannelSelect channels={channels} activeId={active.id} />
            </form>
          )}
          <Link href="/onboarding/channel/new" className="btn hidden md:inline-flex items-center gap-1.5" title="Create a new YouTube channel">
            <Layers className="w-4 h-4" /> + Channel
          </Link>
          <Link href="/channels" className="btn hidden md:inline-flex" title="Manage all channels">Manage channels</Link>
          <LiveTicker initial={ticker} />
          <div className="flex-1" />
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
          <span className="font-mono text-[12px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>{membership.role}</span>
          <span className="hidden md:inline text-[13px] text-[var(--mute)]">{user.email}</span>
        </header>

        <main className="flex-1 overflow-auto bg-[var(--panel)] p-6">{children}</main>
      </div>
    </div>
  );
}

function ChannelSelect({ channels, activeId }: { channels: { id: string; name: string; accentColor: string | null }[]; activeId: string }) {
  const active = channels.find((c) => c.id === activeId);
  return (
    <label className="flex items-center gap-2 font-mono text-[13px] font-semibold pl-1.5 pr-2 py-1 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)] transition" title="Active channel — pick to switch">
      <span
        className="w-7 h-7 rounded-full text-white grid place-items-center text-[11px] font-bold"
        style={{ background: active?.accentColor ?? "var(--accent)" }}
        aria-hidden
      >
        {(active?.name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--mute)] hidden sm:inline">Active</span>
      <ChannelSwitcher channels={channels} activeId={activeId} />
    </label>
  );
}
