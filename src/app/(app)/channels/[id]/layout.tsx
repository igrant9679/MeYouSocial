import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { ChannelSwitcher } from "@/components/ChannelSwitcher";
import { switchChannelAction } from "@/app/actions/channel";
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
  const { channel, workspace } = await requireChannel(id);
  const accent = channel.accentColor ?? "var(--accent)";
  // The channel switcher lives HERE now, not in the app header (One-Loop
  // step 6): only channel-scoped pages need it, and it made the header claim
  // an "active channel" on pages that had nothing to do with one.
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold" style={{ background: accent }}>
          {channel.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="font-mono font-bold text-lg leading-tight">{channel.name}</div>
          <div className="text-xs text-[var(--mute)]">{channel.linkedYoutubeHandle ?? channel.presentationStyle ?? "—"}</div>
        </div>
        {channels.length > 1 && (
          <form action={switchChannelAction} className="ml-auto">
            <input type="hidden" name="to" value="" />
            <label className="flex items-center gap-2 font-mono text-xs font-semibold px-2 py-1 rounded-full border border-[var(--line-2)]" title="Switch channel — lands on this same page for the other channel">
              <span className="text-micro uppercase tracking-wider text-[var(--mute)]">Channel</span>
              <ChannelSwitcher channels={channels} activeId={channel.id} keepSubpath />
            </label>
          </form>
        )}
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
