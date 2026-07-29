import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import Image from "next/image";
import { Image as ImageIcon, Wand2, Copy, History, AlertTriangle } from "lucide-react";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { brainstormThumbnailsAction, cloneThumbnailAction } from "@/app/actions/thumbnails";
import { DeleteButton } from "@/components/DeleteButton";
import { readJson } from "@/lib/db/json";
import { HelpTip } from "@/components/HelpTip";
import { IMAGE_TIPS } from "@/lib/help-tips";
import { resolveImageProviderName } from "@/lib/images";

// MU-08 — AI Thumbnail Studio. Brainstorm + Clone modes + history.

export default async function ThumbnailsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode = "brainstorm" } = await searchParams;
  const { active, workspace } = await getActiveChannel();

  if (!active) {
    return (
      <div className="card max-w-md mx-auto text-center py-10">
        <span className="w-12 h-12 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: "#FBE2EF", color: "#DB2777" }}>
          <ImageIcon className="w-6 h-6" />
        </span>
        <h1 className="font-mono font-bold text-lg mb-2">Pick a channel first</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Thumbnails are channel-scoped — voice, style, and audience condition every concept.</p>
        <Link href="/onboarding/channel/new" className="btn primary">Create a channel</Link>
      </div>
    );
  }

  const history = await db.thumbnail.findMany({
    where: { channel: { workspaceId: workspace.id } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const imageProviderName = await resolveImageProviderName(workspace.id);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#FBE2EF", color: "#DB2777" }}>
          <ImageIcon className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Thumbnail Studio</h1>
          <p className="text-xs text-[var(--mute)]">Channel: <b>{active.name}</b></p>
        </div>
      </div>

      {/* Shown ONLY while the resolved provider is the mock. A placeholder here
          is success-shaped — a real, attractive photo that has nothing to do
          with your title — so it has to be said on the page, not left to a
          tooltip. Once a real provider resolves, the warning must disappear:
          a stale "this is fake" notice over genuine renders is its own lie. */}
      {imageProviderName === "mock" && (
        <div className="card mb-4 flex items-start gap-2 text-sm" style={{ background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--amber-on)" }} />
          <div>
            <b>Images here are placeholders.</b> No image provider is active for this workspace, so every
            render comes back as an unrelated stock photo. The written concepts below <i>are</i> generated
            for real — use those; treat the pictures as layout stand-ins, not artwork to publish.{" "}
            <Link href="/admin/api-keys" className="underline">Turn on a provider →</Link>
          </div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex gap-1 mb-4">
        <TabLink href="/thumbnails?mode=brainstorm" active={mode !== "clone"} icon={<Wand2 className="w-3.5 h-3.5" />}>Brainstorm</TabLink>
        <TabLink href="/thumbnails?mode=clone"      active={mode === "clone"}  icon={<Copy className="w-3.5 h-3.5" />}>Clone / Remix</TabLink>
      </div>

      {mode === "clone" ? (
        <form action={cloneThumbnailAction} className="card flex flex-col gap-3 max-w-2xl mb-6">
          <input type="hidden" name="channelId" value={active.id} />
          <h2 className="font-mono font-bold text-[14px] flex items-center gap-2">
            <Copy className="w-4 h-4" style={{ color: "#DB2777" }} /> Clone a thumbnail&apos;s style
            <HelpTip text={IMAGE_TIPS.clone} side="bottom" wide />
          </h2>
          {/* Was: "We'll analyze palette, typography, composition, and render a
              new thumbnail." The analysis is real; the render is not, and
              promising both oversold the half that doesn't work. */}
          <p className="text-xs text-[var(--mute)]">
            Paste any YouTube URL or image URL. We&apos;ll describe its palette, typography and composition, then
            render a version of that style for your title.
            {imageProviderName === "mock" && " The rendered image is a placeholder until a provider is turned on."}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Reference URL</span>
            <input name="referenceUrl" required placeholder="https://… or @handle" className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm font-mono" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">New video title</span>
            <input name="title" required className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm" />
          </label>
          <div className="flex justify-end">
            <SubmitButton className="btn primary">Render in this style →</SubmitButton>
          </div>
        </form>
      ) : (
        <form action={brainstormThumbnailsAction} className="card flex flex-col gap-3 max-w-2xl mb-6">
          <input type="hidden" name="channelId" value={active.id} />
          <h2 className="font-mono font-bold text-[14px] flex items-center gap-2">
            <Wand2 className="w-4 h-4" style={{ color: "#DB2777" }} /> Brainstorm 4 concepts
            <HelpTip text={IMAGE_TIPS.brainstorm} side="bottom" wide />
          </h2>
          <p className="text-xs text-[var(--mute)]">
            From a working title (and optional topic), we&apos;ll write four concept directions across proven formats
            and render each one.
            {imageProviderName === "mock" && " The written directions are the useful part until a provider is turned on — the images beside them are placeholders."}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Video title</span>
            <input name="title" required placeholder="e.g. Why your morning routine is broken" className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Topic (optional)</span>
            <input name="topic" className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm" />
          </label>
          <div className="flex justify-end">
            <SubmitButton className="btn primary">Brainstorm 4 concepts →</SubmitButton>
          </div>
        </form>
      )}

      {/* History */}
      <section className="card">
        <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><History className="w-4 h-4" style={{ color: "#DB2777" }} /> History <span className="text-xs text-[var(--mute)] font-normal">({history.length})</span></h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--mute)] py-6 text-center">No thumbnails yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {history.map((t) => {
              const concepts = readJson<{ url: string; label: string }[]>(t.concepts, []);
              const previewUrl = t.renderUrl ?? concepts[0]?.url;
              return (
                <div key={t.id} className="rounded-xl overflow-hidden border border-[var(--line)] hover:shadow-md transition">
                  {/* Delete sits beside the Link, never inside it — a form
                      nested in an anchor navigates instead of submitting. */}
                  <Link href={`/thumbnails/${t.id}`} className="block">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt={t.title ?? ""} className="w-full aspect-video object-cover" />
                    ) : (
                      <div className="w-full aspect-video bg-[var(--zebra)] grid place-items-center text-xs text-[var(--mute)]">No preview</div>
                    )}
                    <div className="px-2 pt-2">
                      <div className="text-xs font-semibold truncate">{t.title ?? "Untitled"}</div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{t.mode}{t.renderUrl ? " · rendered" : ""}</div>
                    </div>
                  </Link>
                  <div className="px-2 pb-2 pt-1">
                    <DeleteButton kind="thumbnail" id={t.id} name={t.title ?? "Untitled"} returnTo="/thumbnails" iconOnly />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TabLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition " + (active ? "bg-[#FBE2EF] text-[#DB2777]" : "text-[var(--mute)] hover:bg-[var(--zebra)]")}
    >
      {icon} {children}
    </Link>
  );
}
