import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { prompterBlocks, spokenWords } from "@/lib/teleprompter";
import { Teleprompter } from "./Teleprompter";
import { PrompterRecorder } from "./PrompterRecorder";

// Teleprompter view, full-screen large text. The markdown comes out on the
// server (E-VID-02), so the browser gets lines to read, not syntax.

export default async function TeleprompterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  if (!script) notFound();
  const blocks = prompterBlocks(script.body);

  return (
    // A fixed-height column (VID-17): with min-h-screen the page grew with the
    // text, so the inner scroller never overflowed and auto-scroll did nothing.
    <div className="h-dvh overflow-hidden bg-black text-white flex flex-col">
      <header className="px-5 py-3 flex items-center gap-3 border-b border-white/10">
        <Link href={`/scripts/${id}/publish`} className="text-xs font-mono text-white/60 hover:text-white">← Back</Link>
        <div className="flex-1" />
        <div className="hidden md:block text-[11px] font-mono text-white/40" data-prompter-keys>
          Space play · ↑↓ speed · ←→ nudge · −+ size · M mirror · C countdown · F fullscreen · R top
        </div>
        <div className="text-xs font-mono text-white/60 truncate max-w-[40vw]">{script.title}</div>
        {/* E-VID-14: record a take while reading — saved to Assets, linked to the project. Editors only. */}
        {canEdit(membership.role) && <PrompterRecorder scriptId={script.id} />}
      </header>
      <Teleprompter blocks={blocks} words={spokenWords(blocks)} />
    </div>
  );
}
