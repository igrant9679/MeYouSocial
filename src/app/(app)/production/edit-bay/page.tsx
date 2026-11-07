import Link from "next/link";
import { Scissors, ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setProjectEditStatusAction, setProjectStatusAction } from "@/app/actions/production";

// Edit Bay: kanban on EditStatus.

const COLUMNS = [
  { key: "assembly",    label: "Assembly",     color: "var(--amber)", soft: "var(--amber-soft)" },
  { key: "rough_cut",   label: "Rough cut",    color: "var(--blue)", soft: "var(--blue-soft)" },
  { key: "vfx",         label: "VFX",          color: "var(--violet)", soft: "var(--violet-soft)" },
  { key: "sound_music", label: "Sound & music", color: "var(--cyan)", soft: "var(--cyan-soft)" },
  { key: "color",       label: "Color grading", color: "var(--green)", soft: "var(--green-soft)" },
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
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><Scissors className="w-5 h-5" style={{ color: "var(--violet)" }} /> Edit Bay</h2>
        <span className="text-xs text-[var(--mute)]">({projects.length} in editing)</span>
      </div>

      {projects.length === 0 && <div className="card text-center py-12"><p className="text-sm text-[var(--mute)]">No projects in editing.</p></div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const items = projects.filter((p) => (p.editStatus ?? "assembly") === col.key);
          const next = COLUMNS[COLUMNS.findIndex((c) => c.key === col.key) + 1];
          return (
            <section key={col.key} className="card" style={{ background: `color-mix(in srgb, ${col.soft} 33%, transparent)` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
                <h3 className="font-mono font-bold text-xs uppercase tracking-wider" style={{ color: col.color }}>{col.label}</h3>
                <span className="text-xs text-[var(--mute)]">({items.length})</span>
              </div>
              <ul className="m-0 p-0 flex flex-col gap-2">
                {items.length === 0 && <li className="text-2xs text-[var(--mute)] py-2 text-center">—</li>}
                {items.map((p) => (
                  <li key={p.id} className="bg-[var(--bg)] border border-[var(--line)] rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-6 h-6 rounded-md text-white grid place-items-center text-micro font-mono font-bold" style={{ background: p.channel.accentColor ?? "var(--accent)" }}>{p.channel.name.slice(0, 2).toUpperCase()}</span>
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
                          <button type="submit" className="w-6 h-6 rounded-md grid place-items-center hover:bg-[var(--zebra)]"><ArrowRight className="w-3.5 h-3.5" style={{ color: "var(--teal)" }} /></button>
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
