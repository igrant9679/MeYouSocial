import Link from "next/link";
import { Home, Telescope, Sparkles, PenLine, MessageCircle, Image as ImageIcon, KanbanSquare, Settings, LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { getActiveChannel } from "@/lib/channel";
import { setActiveChannelAction } from "@/app/actions/channel";

// Each nav item carries its own brand color so the rail reads as a vibrant chip strip
// (mirrors the CreateUp_Mockups.html per-module accent palette).
const NAV = [
  { href: "/dashboard",   label: "Home",        icon: Home,         color: "#E5482F", soft: "#FDE7E1" },
  { href: "/intel",       label: "Intel",       icon: Telescope,    color: "#2563EB", soft: "#E5EDFD" },
  { href: "/ideas",       label: "Ideas",       icon: Sparkles,     color: "#D97706", soft: "#FBEED5" },
  { href: "/scripts",     label: "Scripts",     icon: PenLine,      color: "#15924B", soft: "#E0F2E8" },
  { href: "/chat",        label: "Chat",        icon: MessageCircle, color: "#6D28D9", soft: "#EDE7FB" },
  { href: "/thumbnails",  label: "Thumbnails",  icon: ImageIcon,    color: "#DB2777", soft: "#FBE2EF" },
  { href: "/production",  label: "Production",  icon: KanbanSquare, color: "#0D9488", soft: "#D7F1ED" },
  { href: "/admin",       label: "Admin",       icon: Settings,     color: "#4F46E5", soft: "#E7E6FB", adminOnly: true },
];

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, membership, channels, active } = await getActiveChannel();
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <div className="flex-1 flex min-h-screen">
      <aside className="w-[78px] bg-gradient-to-b from-white to-[#fafbfc] border-r border-[var(--line)] flex flex-col items-center gap-2.5 py-5 flex-shrink-0">
        <Link
          href="/dashboard"
          className="w-11 h-11 rounded-2xl text-white grid place-items-center mb-3 font-mono font-bold text-lg shadow-lg shadow-[#E5482F]/30"
          style={{ background: "linear-gradient(150deg,#F0623F,#C53A22)" }}
          title="CreateUp"
        >
          ▲
        </Link>

        {NAV.filter((n) => !n.adminOnly || membership.role === "ADMIN").map((n) => {
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              className="group relative w-11 h-11 rounded-2xl grid place-items-center transition-all duration-150 hover:scale-105"
              style={{ background: n.soft, color: n.color }}
            >
              <Icon className="w-[22px] h-[22px]" strokeWidth={2.25} />
              <span
                className="absolute left-[58px] top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-semibold font-mono px-2.5 py-1 rounded-md text-white shadow-lg opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition pointer-events-none z-30"
                style={{ background: n.color }}
              >
                {n.label}
              </span>
            </Link>
          );
        })}

        <form action={signOutAction} className="mt-auto flex flex-col items-center gap-2">
          <Link
            href={`/settings`}
            title="Profile"
            className="w-10 h-10 rounded-full grid place-items-center font-mono font-bold text-[12px] text-white shadow-md"
            style={{ background: "linear-gradient(135deg,#E5482F,#6D28D9)" }}
          >
            {initials}
          </Link>
          <button title="Sign out" className="w-10 h-10 rounded-2xl grid place-items-center text-[var(--mute)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)] transition">
            <LogOut className="w-[18px] h-[18px]" strokeWidth={2.25} />
          </button>
        </form>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="min-h-[60px] border-b border-[var(--line)] bg-white flex items-center gap-3 px-6 py-2 flex-shrink-0">
          <div className="font-mono font-bold text-[15px] tracking-tight">{workspace.name}</div>
          {active && (
            <form action={setActiveChannelAction}>
              <ChannelSelect channels={channels} activeId={active.id} />
            </form>
          )}
          <Link href="/onboarding/channel/new" className="btn sm" title="Create a new channel">+ Channel</Link>
          <div className="flex-1" />
          <span className="font-mono text-[11px] uppercase tracking-wider font-bold px-2 py-1 rounded-md" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{membership.role}</span>
          <span className="text-[12px] text-[var(--mute)]">{user.email}</span>
        </header>

        <main className="flex-1 overflow-auto bg-[var(--panel)] p-6">{children}</main>
      </div>
    </div>
  );
}

function ChannelSelect({ channels, activeId }: { channels: { id: string; name: string; accentColor: string | null }[]; activeId: string }) {
  const active = channels.find((c) => c.id === activeId);
  return (
    <label className="flex items-center gap-2 font-mono text-[13px] font-semibold pl-1.5 pr-2 py-1 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)] transition">
      <span className="w-6 h-6 rounded-full text-white grid place-items-center text-[11px] font-bold" style={{ background: active?.accentColor ?? "var(--accent)" }}>
        {(active?.name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <select name="channelId" defaultValue={activeId} className="bg-transparent border-0 focus:outline-none pr-1">
        {channels.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button type="submit" className="text-[10px] uppercase tracking-wider text-[var(--mute)] hover:text-[var(--accent)]">switch</button>
    </label>
  );
}
