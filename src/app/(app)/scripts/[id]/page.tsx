import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// Placeholder script detail. Full Canvas (split-panel, plan/script, humanize, etc.)
// lands in Phase 3. For now we show metadata so Write-from-Idea and Turn-into-Script
// flows produce a real, navigable artifact.

export default async function ScriptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: { channel: true, idea: true, template: true },
  });
  if (!script) notFound();

  return (
    <div className="max-w-3xl">
      <Link href={`/channels/${script.channelId}/scripts`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3">
        <ArrowLeft className="w-3 h-3" /> {script.channel.name} · Scripts
      </Link>
      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}>
            <PenLine className="w-5 h-5" strokeWidth={2.25} />
          </span>
          <div className="flex-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{script.workflow} · {script.status}</span>
            <h1 className="font-mono font-bold text-2xl leading-tight">{script.title}</h1>
          </div>
        </div>
        {script.idea && (
          <div className="border-t border-[var(--line)] pt-3 mt-3 text-sm">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">Sourced from idea</div>
            <Link href={`/channels/${script.channelId}/ideas/${script.idea.id}`} className="hover:text-[var(--accent)] font-semibold">{script.idea.title}</Link>
            {script.idea.strategy && <p className="text-xs text-[var(--mute)] mt-1">{script.idea.strategy}</p>}
          </div>
        )}
      </div>

      <div className="card text-center py-10">
        <p className="text-sm text-[var(--mute)] max-w-md mx-auto">The split-panel Canvas — Plan/Script toggle, model selector, Humanize, version history — lands in Phase 3 (FR-CANV-01..15). This script row is persisted; you'll pick up writing here.</p>
      </div>
    </div>
  );
}
