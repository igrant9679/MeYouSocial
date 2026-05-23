import Link from "next/link";
import { requireChannel } from "@/lib/channel";

// FR-CHAN-03 — Channel navigation: Ideas, Scripts, Audience, Competitors + Settings menu.

const SUBNAV = [
  { href: "", label: "Home" },
  { href: "/ideas", label: "Ideas" },
  { href: "/scripts", label: "Scripts" },
  { href: "/audience", label: "Audience" },
  { href: "/competitors", label: "Competitors" },
  { href: "/voice", label: "Voice" },
  { href: "/templates", label: "Templates" },
  { href: "/memory", label: "Memory" },
  { href: "/submissions", label: "Submissions" },
  { href: "/settings", label: "Settings" },
];

export default async function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { channel } = await requireChannel(id);
  const accent = channel.accentColor ?? "var(--accent)";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold" style={{ background: accent }}>
          {channel.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="font-mono font-bold text-lg leading-tight">{channel.name}</div>
          <div className="text-xs text-[var(--mute)]">{channel.linkedYoutubeHandle ?? channel.presentationStyle ?? "—"}</div>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 mb-5 border-b border-[var(--line)]">
        {SUBNAV.map((s) => (
          <Link
            key={s.href}
            href={`/channels/${channel.id}${s.href}`}
            className="text-xs font-mono uppercase tracking-wider px-3 py-2 border-b-2 border-transparent hover:border-[var(--accent)] hover:text-[var(--accent)] text-[var(--mute)]"
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
