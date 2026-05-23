import Link from "next/link";
import { Scissors, ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setProjectEditStatusAction, setProjectStatusAction } from "@/app/actions/production";

// FR-PIPE-04 — Edit Bay: kanban on EditStatus.

const COLUMNS = [
  { key: "assembly",    label: "Assembly",     color: "#D97706", soft: "#FBEED5" },
  { key: "rough_cut",   label: "Rough cut",    color: "#2563EB", soft: "#E5EDFD" },
  { key: "vfx",         label: "VFX",          color: "#6D28D9", soft: "#EDE7FB" },
  { key: "sound_music", label: "Sound & music", color: "#0891B2", soft: "#D8EFF5" },
  { key: "color",       label: "Color grading", color: "#15924B", soft: "#E0F2E8" },
] as const;

export default async function EditBayPage() {
  const { workspace } = await requireMembership();
  const projects = await db.contentProject.findMany({
    where: { channel: { workspaceId: workspace.id }, status: "editing" },
    include: { channel: { select: { name: true, accentColor: true } }, script: { select: { id: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><Scissors className="w-5 h-5" style={{ color: "#6D28D9" }} /> Edit Bay</h2>
        <span className="text-xs text-[var(--mute)]">({projects.length} in editing)</span>
      </div>

      {projects.length === 0 && <div className="card text-center py-12"><p className="text-sm text-[var(--mute)]">No projects in editing.</p></div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const items = projects.filter((p) => (p.editStatus ?? "assembly") === col.key);
          const next = COLUMNS[COLUMNS.findIndex((c) => c.key === col.key) + 1];
          return (
            <section key={col.key} className="card" style={{ background: col.soft + "55" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
                <h3 className="font-mono font-bold text-xs uppercase tracking-wider" style={{ color: col.color }}>{col.label}</h3>
                <span className="text-xs text-[var(--mute)]">({items.length})</span>
              </div>
              <ul className="m-0 p-0 flex flex-col gap-2">
                {items.length === 0 && <li className="text-[11px] text-[var(--mute)] py-2 text-center">—</li>}
                {items.map((p) => (
                  <li key={p.id} className="bg-white border border-[var(--line)] rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-6 h-6 rounded-md text-white grid place-items-center text-[10px] font-mono font-bold" style={{ background: p.channel.accentColor ?? "var(--accent)" }}>{p.channel.name.slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1" />
                      {next ? (
                        <form action={setProjectEditStatusAction} title={`Move to ${next.label}`}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="editStatus" value={next.key} />
                          <button type="submit" className="w-6 h-6 rounded-md grid place-items-center hover:bg-[var(--zebra)]"><ArrowRight className="w-3.5 h-3.5" style={{ color: next.color }} /></button>
                        </form>
                      ) : (
                        <form action={setProjectStatusAction} title="Move to Scheduled">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="status" value="scheduled" />
                          <button type="submit" className="w-6 h-6 rounded-md grid place-items-center hover:bg-[var(--zebra)]"><ArrowRight className="w-3.5 h-3.5" style={{ color: "#0D9488" }} /></button>
                        </form>
                      )}
                    </div>
                    {p.script ? (
                      <Link href={`/scripts/${p.script.id}`} className="font-semibold text-sm hover:text-[var(--accent)]">{p.title}</Link>
                    ) : (
                      <div className="font-semibold text-sm">{p.title}</div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
