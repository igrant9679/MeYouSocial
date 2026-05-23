import Link from "next/link";
import { ArrowLeft, Download, CheckCircle2 } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { renderThumbnailAction } from "@/app/actions/thumbnails";
import { scoreThumbnailAction } from "@/app/actions/final-pass";
import { Gauge } from "lucide-react";

// MU-08 — Thumbnail detail. Pick one of the 4 concepts to render at full resolution
// (FR-THUMB-02), or download the existing render.

export default async function ThumbnailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const thumb = await db.thumbnail.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!thumb) notFound();

  const conceptsBlob = readJson<{ id: string; label: string; description: string; url: string }[] | { items: { id: string; label: string; description: string; url: string }[]; critique?: string }>(thumb.concepts, []);
  const concepts = Array.isArray(conceptsBlob) ? conceptsBlob : conceptsBlob.items;
  const critique = Array.isArray(conceptsBlob) ? undefined : conceptsBlob.critique;

  return (
    <div>
      <Link href="/thumbnails" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to Thumbnails</Link>

      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-mono font-bold text-2xl leading-tight">{thumb.title ?? "Untitled"}</h1>
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded" style={{ background: "#FBE2EF", color: "#DB2777" }}>{thumb.mode}</span>
        <span className="text-xs text-[var(--mute)]">· {thumb.channel.name}</span>
      </div>

      {thumb.renderUrl ? (
        <section className="card mb-5">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} /> Rendered thumbnail</h2>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb.renderUrl} alt={thumb.title ?? ""} className="w-full max-w-2xl rounded-xl border border-[var(--line)]" />
            <div className="flex flex-col gap-2">
              <a href={thumb.renderUrl} download className="btn primary flex items-center gap-2"><Download className="w-4 h-4" /> Download</a>
              <a href={thumb.renderUrl} target="_blank" rel="noopener noreferrer" className="btn">Open full size</a>
              <form action={scoreThumbnailAction}>
                <input type="hidden" name="thumbnailId" value={thumb.id} />
                <button type="submit" className="btn w-full flex items-center justify-center gap-2"><Gauge className="w-4 h-4" /> {thumb.ctrScore ? "Re-score CTR" : "Score CTR (FR-THUMB-04)"}</button>
              </form>
              {thumb.ctrScore != null && (
                <div className="text-center mt-1">
                  <div className="font-mono font-bold text-3xl" style={{ color: thumb.ctrScore >= 75 ? "var(--green)" : thumb.ctrScore >= 50 ? "var(--amber)" : "var(--brand)" }}>{Math.round(thumb.ctrScore)}</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">CTR score</div>
                </div>
              )}
            </div>
          </div>
          {critique && (
            <div className="mt-3 text-xs font-mono bg-[var(--zebra)] rounded-md p-3 whitespace-pre-wrap">{critique}</div>
          )}
        </section>
      ) : null}

      {concepts.length > 0 && (
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Concepts {thumb.renderUrl ? "" : "— pick one to render"}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {concepts.map((c) => (
              <div key={c.id} className="border border-[var(--line)] rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={c.label} className="w-full aspect-video object-cover" />
                <div className="p-3">
                  <div className="font-semibold text-sm">{c.label}</div>
                  <div className="text-xs text-[var(--mute)] mt-1 line-clamp-3">{c.description}</div>
                  {!thumb.renderUrl && (
                    <form action={renderThumbnailAction} className="mt-2">
                      <input type="hidden" name="thumbnailId" value={thumb.id} />
                      <input type="hidden" name="conceptId" value={c.id} />
                      <button type="submit" className="btn primary sm w-full">Render this</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
