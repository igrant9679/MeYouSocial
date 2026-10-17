import Link from "next/link";
import { ImagePlus, PenSquare } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/EmptyState";
import { Banner } from "@/components/SocialPostCard";
import { updateMediaAction, uploadMediaAction } from "@/app/actions/media-library";

// Distribute → Media (Socialmonials parity, phase 4, 2026-10-17): the
// workspace's images, kept for reuse. A description here is what Caption
// Studio's "from image descriptions" writes from.

type SP = { ok?: string; err?: string; flash?: string };
const inputCls = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

export default async function MediaLibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const sp = await searchParams;
  const items = await db.mediaItem.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 120 });

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <h1 className="font-mono text-[22px] font-bold m-0">Media</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">Images kept for reuse — attach them to a post, or write a caption for each in Caption Studio from its description.</p>
      </div>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}
      {sp.flash && <Banner kind="ok" text={sp.flash} />}

      {editor && (
        <form action={uploadMediaAction} encType="multipart/form-data" className="card mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Images (up to 20)</span><input type="file" name="files" multiple required accept="image/png,image/jpeg,image/gif,image/webp" className="text-xs" /></label>
          <label className="text-xs flex-1 min-w-64"><span className="block text-[10px] text-[var(--mute)] mb-1">Description (optional — applies to all; edit each below)</span><input name="description" maxLength={600} className={`${inputCls} w-full`} placeholder="What the picture shows — Caption Studio writes from this" /></label>
          <SubmitButton className="btn primary" pendingText="Uploading…"><ImagePlus className="w-4 h-4" /> Add to the library</SubmitButton>
        </form>
      )}

      {items.length === 0 ? (
        <EmptyState line="The library is empty." note="Images you upload here can be attached to any post, and their descriptions become captions in Caption Studio." />
      ) : (
        <>
          {editor && (
            <form method="get" action="/social/compose" id="use-media" className="flex items-center gap-2 mb-2 text-xs">
              <span className="text-[var(--mute)]">Tick images, then</span>
              <button className="btn sm" type="submit"><PenSquare className="w-3 h-3" /> Use in a new post</button>
              <Link href="/social/captions?s=images" className="btn sm">Write captions from their descriptions</Link>
            </form>
          )}
          <ul className="grid gap-3 m-0 p-0 list-none" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {items.map((m) => (
              <li key={m.id} className="card !p-2 flex flex-col gap-1.5">
                <a href={storage.url(m.key)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={storage.url(m.key)} alt={m.description ?? m.name} className="w-full aspect-video object-cover rounded-lg border border-[var(--line)]" />
                </a>
                {editor ? (
                  <form action={updateMediaAction} className="flex flex-col gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="name" defaultValue={m.name} maxLength={200} className={inputCls} />
                    <textarea name="description" defaultValue={m.description ?? ""} rows={2} maxLength={600} placeholder="No description yet" className={inputCls} />
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] inline-flex items-center gap-1 mr-auto"><input type="checkbox" name="media" value={m.id} form="use-media" /> use</label>
                      <SubmitButton className="btn sm" pendingText="…">Save</SubmitButton>
                      <DeleteButton kind="mediaItem" id={m.id} name={m.name} returnTo="/social/media" iconOnly />
                    </div>
                  </form>
                ) : (
                  <p className="text-[11px] m-0">{m.description ?? <span className="text-[var(--mute)]">{m.name}</span>}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
