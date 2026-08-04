import { requireChannel } from "@/lib/channel";
import { ChannelSubNav } from "@/components/ChannelSubNav";
import { CHANNEL_TAB_TIPS } from "@/lib/help-tips";

// Channel navigation: Ideas, Scripts, Audience, Competitors + Settings menu.

const SUBNAV = [
  { href: "", label: "Home" },
  { href: "/ideas", label: "Ideas" },
  { href: "/scripts", label: "Scripts" },
  { href: "/audience", label: "Audience" },
  { href: "/competitors", label: "Competitors" },
  { href: "/voice", label: "Voice" },
  { href: "/templates", label: "Templates" },
  { href: "/memory", label: "Memory" },
  { href: "/research", label: "Research" },
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
      <ChannelSubNav
        base={`/channels/${channel.id}`}
        accent={accent}
        items={SUBNAV.map((s) => ({ ...s, tip: CHANNEL_TAB_TIPS[s.href] }))}
      />
      {children}
    </div>
  );
}
