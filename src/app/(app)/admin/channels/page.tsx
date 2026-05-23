import Link from "next/link";
import { Layers } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { transferChannelOwnershipAction } from "@/app/actions/admin";

// FR-ADMIN-05 — Admins can reassign / manage channels. v1: tweak accent color, see
// linkage to scripts / projects / submissions. Full ownership transfer (between workspaces)
// is out of scope since channels are workspace-scoped by design.

const PALETTE = ["#E5482F", "#6D28D9", "#2563EB", "#0D9488", "#D97706", "#DB2777", "#4F46E5", "#15924B", "#0891B2", "#7C3AED", "#E11D48"];

export default async function AdminChannelsPage() {
  const { workspace } = await requireRole("ADMIN");
  const channels = await db.channel.findMany({
    where: { workspaceId: workspace.id },
    include: {
      _count: {
        select: { scripts: true, ideas: true, contentProjects: true, voiceProfiles: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
          <Layers className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Channels admin</h1>
          <p className="text-xs text-[var(--mute)]">{channels.length} channels. Click any to manage from the channel surface.</p>
        </div>
      </div>

      <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        {channels.map((c) => (
          <li key={c.id} className="card">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold text-sm" style={{ background: c.accentColor ?? "var(--accent)" }}>{c.name.slice(0, 2).toUpperCase()}</span>
              <div className="flex-1 min-w-0">
                <Link href={`/channels/${c.id}`} className="font-semibold hover:text-[var(--accent)]">{c.name}</Link>
                <div className="text-xs text-[var(--mute)]">
                  {c._count.scripts} scripts · {c._count.ideas} ideas · {c._count.contentProjects} projects · {c._count.voiceProfiles} voices
                </div>
              </div>
            </div>
            <form action={transferChannelOwnershipAction} className="flex items-center gap-2">
              <input type="hidden" name="channelId" value={c.id} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Accent</span>
              <div className="flex items-center gap-1 flex-wrap">
                {PALETTE.map((p) => (
                  <label key={p} className="relative">
                    <input type="radio" name="accentColor" value={p} defaultChecked={c.accentColor === p} className="peer sr-only" />
                    <span className="w-5 h-5 rounded-full block cursor-pointer ring-1 ring-[var(--line-2)] peer-checked:ring-2 peer-checked:ring-offset-1 peer-checked:ring-black" style={{ background: p }} />
                  </label>
                ))}
              </div>
              <span className="flex-1" />
              <button type="submit" className="btn sm">Save</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
