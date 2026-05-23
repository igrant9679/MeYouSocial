import { Layers, Trash2, Sparkles, Plus } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { cloneTemplateAction, deleteTemplateAction } from "@/app/actions/templates";

// FR-TMPL — Templates manager. Lists built-in + custom; clone-from-video.

export default async function ChannelTemplatesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { id } = await params;
  const { focus } = await searchParams;
  await requireChannel(id);

  const templates = await db.template.findMany({
    where: { OR: [{ channelId: id }, { channelId: null }] },
    orderBy: [{ channelId: "desc" }, { name: "asc" }],
  });
  const custom = templates.filter((t) => t.channelId === id);
  const builtIn = templates.filter((t) => t.channelId === null);
  const focused = focus ? templates.find((t) => t.id === focus) : null;
  const focusedStructure = focused ? readJson<{ ai?: string; sections?: string[]; sources?: string[] }>(focused.structure, {}) : null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E7E6FB", color: "#4F46E5" }}>
          <Layers className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-lg leading-tight">Templates</h2>
          <p className="text-xs text-[var(--mute)]">{builtIn.length} built-in · {custom.length} custom</p>
        </div>
      </div>

      {/* Clone from video(s) */}
      <form action={cloneTemplateAction} className="card mb-5">
        <h3 className="font-mono font-bold text-[14px] mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: "#4F46E5" }} /> Clone a template from a video (FR-TMPL-03/04)</h3>
        <p className="text-xs text-[var(--mute)] mb-3">Paste 1 YouTube URL/handle to clone its structure, or 2-3 to synthesize a hybrid template.</p>
        <input type="hidden" name="channelId" value={id} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Template name</span>
            <input name="name" required placeholder="e.g. My listicle template" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Kind</span>
            <select name="kind" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
              <option value="long">Long-form</option>
              <option value="short">Shorts</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">References (1-3 YouTube URLs or @handles, comma or newline-separated)</span>
          <textarea name="references" required rows={3} placeholder="@example-channel, https://youtube.com/watch?v=…" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <div className="flex justify-end mt-2"><button type="submit" className="btn primary sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Clone</button></div>
      </form>

      {/* Focused template detail */}
      {focused && (
        <section className="card mb-5">
          <div className="flex items-center mb-2">
            <h3 className="font-mono font-bold text-[14px] flex items-center gap-2">{focused.name}</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider ml-2 px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{focused.source}</span>
            <span className="text-xs text-[var(--mute)] ml-2">· {focused.kind}</span>
          </div>
          {focusedStructure?.sources && focusedStructure.sources.length > 0 && (
            <p className="text-xs text-[var(--mute)] mb-2 font-mono">Sources: {focusedStructure.sources.join(" · ")}</p>
          )}
          {focusedStructure?.ai && (
            <pre className="text-xs whitespace-pre-wrap bg-[var(--zebra)] rounded-md p-3 font-mono max-h-96 overflow-auto">{focusedStructure.ai}</pre>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Custom */}
        <section className="card">
          <h3 className="font-mono font-bold text-[14px] mb-3">Custom templates ({custom.length})</h3>
          {custom.length === 0 && <p className="text-xs text-[var(--mute)] text-center py-3">No custom templates yet — clone one above.</p>}
          <ul className="m-0 p-0">
            {custom.map((t) => (
              <li key={t.id} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-sm">
                <Layers className="w-3.5 h-3.5" style={{ color: "#4F46E5" }} />
                <a href={`/channels/${id}/templates?focus=${t.id}`} className="flex-1 font-semibold hover:text-[var(--accent)]">{t.name}</a>
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{t.kind}</span>
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="channelId" value={id} />
                  <button type="submit" className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        {/* Built-in */}
        <section className="card">
          <h3 className="font-mono font-bold text-[14px] mb-3">Built-in templates ({builtIn.length})</h3>
          <ul className="m-0 p-0 grid grid-cols-1 gap-1">
            {builtIn.map((t) => (
              <li key={t.id} className="py-1.5 flex items-center gap-2 text-sm border-t border-[var(--line)] first:border-t-0">
                <Layers className="w-3.5 h-3.5 text-[var(--mute)]" />
                <span className="flex-1">{t.name}</span>
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--mute)]" style={{ background: "var(--zebra)" }}>{t.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
