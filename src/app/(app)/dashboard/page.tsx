import Link from "next/link";
import { Sparkles, PenLine, Telescope, MessageCircle, Image as ImageIcon, ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// MU-01 — Dashboard home. Vibrant, color-keyed surfaces matching the mockup palette.

export default async function DashboardPage() {
  const { workspace, user } = await requireMembership();

  const [channelCount, scriptCount, ideaCount, recentScripts, recentIdeas, channels] = await Promise.all([
    db.channel.count({ where: { workspaceId: workspace.id } }),
    db.script.count({ where: { channel: { workspaceId: workspace.id } } }),
    db.idea.count({ where: { channel: { workspaceId: workspace.id } } }),
    db.script.findMany({
      where: { channel: { workspaceId: workspace.id } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { channel: { select: { name: true, accentColor: true } } },
    }),
    db.idea.findMany({
      where: { channel: { workspaceId: workspace.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { channel: { select: { name: true, accentColor: true } } },
    }),
    db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const firstName = (user.name ?? user.email).split(/[\s@]/)[0];

  return (
    <div>
      {/* Hero banner */}
      <div className="rounded-[20px] p-7 mb-6 text-white relative overflow-hidden shadow-xl shadow-[#E5482F]/20"
           style={{ background: "linear-gradient(115deg,#E5482F 0%,#B5371F 45%,#6D28D9 100%)" }}>
        <h1 className="font-mono text-[28px] font-bold m-0 flex items-center gap-3 leading-tight">
          Welcome back, {firstName} <Sparkles className="w-6 h-6" />
        </h1>
        <p className="opacity-90 text-[14px] mt-1.5 max-w-xl">From idea to first draft in about twelve minutes. Pick up where you left off — or start something new.</p>

        <div className="absolute right-6 top-6 flex gap-2">
          <PillStat label="channels" value={channelCount} />
          <PillStat label="scripts" value={scriptCount} />
          <PillStat label="ideas" value={ideaCount} />
        </div>

        <div className="absolute -right-16 -bottom-24 w-[300px] h-[300px] rounded-full border border-white/15" />
        <div className="absolute -left-10 -top-32 w-[180px] h-[180px] rounded-full bg-white/5 backdrop-blur" />
      </div>

      {/* Quick start tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <QuickTile href={`/channels/${channels[0]?.id ?? ""}/ideas`} disabled={!channels[0]} label="Generate ideas" icon={Sparkles} color="#D97706" soft="#FBEED5" />
        <QuickTile href="/scripts" label="Write a script" icon={PenLine} color="#15924B" soft="#E0F2E8" />
        <QuickTile href="/intel" label="Explore Intel" icon={Telescope} color="#2563EB" soft="#E5EDFD" />
        <QuickTile href="/chat" label="Brainstorm chat" icon={MessageCircle} color="#6D28D9" soft="#EDE7FB" />
      </div>

      {/* Channels strip */}
      {channels.length > 0 && (
        <section className="card mb-6">
          <div className="flex items-center mb-3">
            <h2 className="font-mono text-[15px] font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" style={{ color: "var(--accent)" }} /> Your channels</h2>
            <span className="flex-1" />
            <Link href="/onboarding/channel/new" className="text-xs font-mono text-[var(--accent)] font-semibold flex items-center gap-1 hover:underline">+ new channel</Link>
          </div>
          <div className="flex gap-3 flex-wrap">
            {channels.map((c) => (
              <Link key={c.id} href={`/channels/${c.id}`} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[var(--line)] hover:border-[var(--accent)] hover:shadow-md transition group">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-mono font-bold text-sm" style={{ background: c.accentColor ?? "var(--accent)" }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="text-[11px] text-[var(--mute)]">{c.presentationStyle ?? "—"} · {c.defaultLanguage}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-[var(--mute)] group-hover:text-[var(--accent)] ml-1" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: recent scripts + latest ideas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="font-mono text-[15px] font-bold mb-3 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}><PenLine className="w-4 h-4" strokeWidth={2.5} /></span>
            Recent scripts
          </h2>
          {recentScripts.length === 0 && <EmptyHint label="No scripts yet" cta={{ href: "/scripts", text: "Start a script" }} />}
          <ul className="m-0 p-0">
            {recentScripts.map((s) => (
              <li key={s.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl grid place-items-center font-mono text-[11px] font-bold text-white shadow-sm" style={{ background: s.channel.accentColor ?? "var(--accent)" }}>{s.channel.name.slice(0, 2).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{s.title}</div>
                  <div className="text-xs text-[var(--mute)]">{s.channel.name} · {s.wordCount} words · {s.status}</div>
                </div>
                <Link href={`/scripts/${s.id}`} className="btn sm">Open</Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="font-mono text-[15px] font-bold mb-3 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: "#FBEED5", color: "#D97706" }}><Sparkles className="w-4 h-4" strokeWidth={2.5} /></span>
            Latest ideas
          </h2>
          {recentIdeas.length === 0 && <EmptyHint label="No ideas yet" cta={{ href: channels[0] ? `/channels/${channels[0].id}/ideas` : "/onboarding/channel/new", text: "Generate ideas" }} />}
          <ul className="m-0 p-0">
            {recentIdeas.map((i) => (
              <li key={i.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3">
                <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: outlierColor(i.outlierScore ?? 0).soft, color: outlierColor(i.outlierScore ?? 0).color }}>
                  {i.outlierScore?.toFixed(1) ?? "—"}x
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{i.title}</div>
                  <div className="text-xs text-[var(--mute)]">{i.channel.name} · {i.suggestedLength ?? "—"}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function PillStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/15 border border-white/25 backdrop-blur-sm rounded-xl px-3.5 py-2 text-center min-w-[68px]">
      <div className="font-mono font-bold text-lg leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-80 mt-0.5">{label}</div>
    </div>
  );
}

function QuickTile({ href, label, icon: Icon, color, soft, disabled }: { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; color: string; soft: string; disabled?: boolean }) {
  const cls = "card flex items-center gap-3 hover:shadow-lg transition group " + (disabled ? "opacity-40 pointer-events-none" : "");
  return (
    <Link href={href} className={cls} style={{ borderColor: "var(--line)" }}>
      <span className="w-11 h-11 rounded-xl grid place-items-center group-hover:scale-105 transition" style={{ background: soft, color }}>
        <Icon className="w-5 h-5" strokeWidth={2.25} />
      </span>
      <div className="flex-1">
        <div className="font-semibold text-sm leading-tight">{label}</div>
        <div className="text-[11px] text-[var(--mute)] flex items-center gap-1">go <ArrowRight className="w-3 h-3" /></div>
      </div>
    </Link>
  );
}

function EmptyHint({ label, cta }: { label: string; cta: { href: string; text: string } }) {
  return (
    <div className="text-sm text-[var(--mute)] py-8 text-center">
      <div className="mb-3">{label}</div>
      <Link href={cta.href} className="btn primary sm">{cta.text}</Link>
    </div>
  );
}

function outlierColor(score: number): { color: string; soft: string } {
  if (score >= 5) return { color: "#E5482F", soft: "#FDE7E1" };
  if (score >= 2) return { color: "#D97706", soft: "#FBEED5" };
  if (score >= 1) return { color: "#2563EB", soft: "#E5EDFD" };
  return { color: "#6B7280", soft: "#F5F7FA" };
}
