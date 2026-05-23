import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { upsertWikiDocAction } from "@/app/actions/production";

export default async function WikiDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const [doc, channels] = await Promise.all([
    db.wikiDoc.findFirst({ where: { id, workspaceId: workspace.id } }),
    db.channel.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  if (!doc) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/production/wiki" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Wiki</Link>

      <form action={upsertWikiDocAction} className="card flex flex-col gap-3">
        <input type="hidden" name="id" value={doc.id} />
        <input name="title" defaultValue={doc.title} required className="font-mono font-bold text-xl border-0 border-b border-transparent hover:border-[var(--line-2)] focus:border-[var(--accent)] focus:outline-none bg-transparent pb-1" />
        <select name="channelId" defaultValue={doc.channelId ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm self-start">
          <option value="">Whole workspace</option>
          {channels.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <textarea name="body" defaultValue={doc.body} rows={28} className="border border-[var(--line-2)] rounded-lg p-3 text-sm font-mono leading-[1.6]" />
        <div className="flex justify-between items-center">
          <span className="text-xs text-[var(--mute)]">Updated {new Date(doc.updatedAt).toLocaleString()}</span>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}
