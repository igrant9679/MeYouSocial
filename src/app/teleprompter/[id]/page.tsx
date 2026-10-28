import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { Teleprompter } from "./Teleprompter";

// Teleprompter view, full-screen large text.

export default async function TeleprompterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  if (!script) notFound();

  return (
    // A fixed-height column (VID-17): with min-h-screen the page grew with the
    // text, so the inner scroller never overflowed and auto-scroll did nothing.
    <div className="h-dvh overflow-hidden bg-black text-white flex flex-col">
      <header className="px-5 py-3 flex items-center gap-3 border-b border-white/10">
        <Link href={`/scripts/${id}/publish`} className="text-xs font-mono text-white/60 hover:text-white">← Back</Link>
        <div className="flex-1" />
        <div className="text-xs font-mono text-white/60 truncate">{script.title}</div>
      </header>
      <Teleprompter body={script.body ?? ""} />
    </div>
  );
}
