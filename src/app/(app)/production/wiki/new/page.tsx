import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { upsertWikiDocAction } from "@/app/actions/production";

export default async function NewWikiPage() {
  const { workspace } = await requireMembership();
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id } });
  return (
    <div className="w-full">
      <Link href="/production/wiki" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Wiki</Link>
      <form action={upsertWikiDocAction} className="card flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Title</span>
          <input name="title" required className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-semibold" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Scope</span>
          <select name="channelId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">Whole workspace</option>
            {channels.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Body (Markdown supported)</span>
          <textarea name="body" rows={18} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <div className="flex justify-end">
          <SubmitButton className="btn primary">Create page</SubmitButton>
        </div>
      </form>
    </div>
  );
}
