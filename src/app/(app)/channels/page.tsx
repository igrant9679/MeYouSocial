import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Layers, Plus, Star, ArrowRight, Mic2, Brain, Image as ImageIcon, FileText, Sparkles } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setActiveChannelAction } from "@/app/actions/channel";
import { getActiveChannel } from "@/lib/channel";

// Channels manager — list every YouTube channel in this workspace, with
// quick-switch + manage-everything controls per card.

export default async function ChannelsManagerPage() {
  const { workspace } = await requireMembership();
  const { active } = await getActiveChannel();
  const channels = await db.channel.findMany({
    where: { workspaceId: workspace.id },
    include: {
      _count: { select: { scripts: true, ideas: true, voiceProfiles: true, contentProjects: true } },
      audience: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Layers className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Your channels</h1>
          <p className="text-xs text-[var(--mute)]">Each channel keeps its own voice, audience, ideas, scripts, research, and templates.</p>
        </div>
        <span className="flex-1" />
        <Link href="/onboarding/channel/new" className="btn primary flex items-center gap-2"><Plus className="w-4 h-4" /> New channel</Link>
      </div>

      {channels.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-sm text-[var(--mute)] mb-3">No channels yet — create your first one to start scripting.</p>
          <Link href="/onboarding/channel/new" className="btn primary">Create your first channel</Link>
        </div>
      ) : (
        <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
          {channels.map((c) => (
            <li key={c.id} className="card flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-2xl text-white grid place-items-center font-mono font-bold text-lg shadow-sm" style={{ background: c.accentColor ?? "var(--accent)" }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/channels/${c.id}`} className="font-mono font-bold text-lg leading-tight hover:text-[var(--accent)]">{c.name}</Link>
                    {active?.id === c.id && <span className="text-micro font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Star className="w-3 h-3" fill="currentColor" /> active</span>}
                  </div>
                  <div className="text-xs text-[var(--mute)]">
                    {c.linkedYoutubeHandle ?? c.presentationStyle ?? "—"} · {c.defaultLanguage}
                  </div>
                </div>
              </div>

              {c.nicheDescription && (
                <p className="text-xs text-[var(--mute)] line-clamp-2">{c.nicheDescription}</p>
              )}

              {/* Counts */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat n={c._count.ideas}           label="Ideas" />
                <Stat n={c._count.scripts}         label="Scripts" />
                <Stat n={c._count.voiceProfiles}   label="Voices" />
                <Stat n={c._count.contentProjects} label="Projects" />
              </div>

              {/* Sub-page shortcuts */}
              <div className="flex flex-wrap gap-1">
                <ChannelChip href={`/ideas?channel=${c.id}`}     icon={<Sparkles className="w-3 h-3" />}     color="var(--amber-on)">Ideas</ChannelChip>
                <ChannelChip href={`/channels/${c.id}/scripts`}   icon={<FileText className="w-3 h-3" />}     color="var(--green-on)">Scripts</ChannelChip>
                <ChannelChip href={`/channels/${c.id}/voice`}     icon={<Mic2 className="w-3 h-3" />}         color="var(--brand-on)">Voice</ChannelChip>
                <ChannelChip href={`/channels/${c.id}/audience`}  icon={<ImageIcon className="w-3 h-3" />}    color="var(--blue-on)">Audience</ChannelChip>
                <ChannelChip href={`/channels/${c.id}/memory`}    icon={<Brain className="w-3 h-3" />}        color="var(--violet-on)">Memory</ChannelChip>
                <ChannelChip href={`/channels/${c.id}/settings`}                                              color="var(--teal-on)">Settings</ChannelChip>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-1">
                {active?.id !== c.id && (
                  <form action={setActiveChannelAction} className="flex-1">
                    <input type="hidden" name="channelId" value={c.id} />
                    <SubmitButton className="btn primary sm w-full">Switch to this channel</SubmitButton>
                  </form>
                )}
                <Link href={`/channels/${c.id}`} className="btn sm flex items-center gap-1.5">Open <ArrowRight className="w-3.5 h-3.5" /></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="border border-[var(--line)] rounded-lg py-1.5">
      <div className="font-mono font-bold text-lg leading-none">{n}</div>
      <div className="text-micro font-mono uppercase tracking-wider text-[var(--mute)] mt-0.5">{label}</div>
    </div>
  );
}

function ChannelChip({ href, icon, color, children }: { href: string; icon?: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-mono uppercase tracking-wider border hover:shadow" style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, color }}>
      {icon} {children}
    </Link>
  );
}
