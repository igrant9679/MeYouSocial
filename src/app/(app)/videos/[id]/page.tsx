import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Captions, Clapperboard, Download, Film, Mic, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/SubmitButton";
import { parseScenes } from "@/lib/captions";
import {
  addSceneAction,
  assembleRenderAction,
  deleteSceneAction,
  generateSrtAction,
  generateVoiceoverAction,
  processRenderNowAction,
  retryRenderAction,
  updateSceneAction,
} from "@/app/actions/videos";

// The storyboard editor: scene-by-scene plan for one render. Scenes are
// editable until rendering starts; after that the board becomes the record of
// what was actually rendered (editing it would desync clips and captions).

const STATUS_HUE: Record<string, string> = {
  queued: "amber",
  rendering: "blue",
  done: "green",
  failed: "rose",
};

const SCENE_GRADIENTS = [
  "linear-gradient(135deg,#2563EB,#0D9488)",
  "linear-gradient(135deg,#6D28D9,#DB2777)",
  "linear-gradient(135deg,#D97706,#E5482F)",
  "linear-gradient(135deg,#15924B,#0891B2)",
  "linear-gradient(135deg,#4F46E5,#7C3AED)",
  "linear-gradient(135deg,#DB2777,#D97706)",
];

export default async function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render) notFound();
  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const scenes = parseScenes(render.scenes);
  const renderedClips = scenes.filter((s) => s.outputUrl).length;
  const editable = editor && (render.status === "queued" || render.status === "failed");
  const hue = STATUS_HUE[render.status] ?? "cyan";
  const post = render.blogPostId
    ? await db.blogPost.findUnique({ where: { id: render.blogPostId }, select: { id: true, title: true } })
    : null;

  return (
    <main className="w-full">
      <Link href="/videos" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Videos
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Clapperboard className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-xl leading-tight">{render.title}</h1>
          <p className="text-xs text-[var(--mute)]">
            {render.aspect} · {render.seconds}s total · est ${render.costEstimate.toFixed(2)} · provider {render.provider}
            {post && <> · from <Link href={`/blog/${post.id}`} className="underline">{post.title}</Link></>}
          </p>
        </div>
        <span className="font-mono text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
          {render.status}
        </span>
      </div>
      {render.error && (
        <p className="text-xs mb-2 px-3 py-2 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          {render.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {render.status === "failed" && editor && (
          <form action={retryRenderAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn"><RotateCcw className="w-4 h-4" /> Retry (re-queue)</SubmitButton>
          </form>
        )}
        {render.status === "queued" && admin && (
          <form action={processRenderNowAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn primary" pendingText="Rendering… (can take minutes)">
              <Play className="w-4 h-4" /> Render now
            </SubmitButton>
          </form>
        )}
        {editor && scenes.length > 0 && (
          <form action={generateSrtAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn" pendingText="Generating…"><Captions className="w-4 h-4" /> {render.srt ? "Regenerate captions" : "Generate captions (SRT)"}</SubmitButton>
          </form>
        )}
        {editor && (
          <form action={generateVoiceoverAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn" pendingText="Speaking…"><Mic className="w-4 h-4" /> {render.voiceoverUrl ? "Regenerate voiceover" : "Generate voiceover"}</SubmitButton>
          </form>
        )}
      </div>

      {/* Scenes */}
      {/* Container-based columns: scene cards hold editable forms, which need
          ~280px each — viewport breakpoints overshot once the rail and the XL
          content-size ate into the real space. */}
      <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 gap-3 mb-4">
        {scenes.map((scene, i) => (
          <div key={i} className="card !p-0 overflow-hidden flex flex-col">
            <div className="h-16 grid place-items-center text-white font-mono font-bold text-xs" style={{ background: SCENE_GRADIENTS[i % SCENE_GRADIENTS.length] }}>
              SCENE {i + 1}{i === 0 ? " · HOOK" : i === scenes.length - 1 ? " · CTA" : ""}
            </div>
            <div className="p-3 flex-1 flex flex-col gap-2">
              {editable ? (
                <form action={updateSceneAction} className="flex flex-col gap-2 flex-1">
                  <input type="hidden" name="id" value={render.id} />
                  <input type="hidden" name="index" value={i} />
                  <textarea name="prompt" defaultValue={scene.prompt} rows={4} className="w-full text-[11px]" aria-label={`Scene ${i + 1} prompt`} />
                  <input name="text" defaultValue={scene.text ?? ""} placeholder="on-screen text (≤8 words)" className="w-full text-[11px]" />
                  <div className="flex items-center gap-2">
                    <input name="seconds" type="number" min={2} max={env.VIDEO_MAX_SECONDS} defaultValue={scene.seconds} className="w-16 font-mono text-[11px]" aria-label="Seconds" />
                    <span className="text-[10px] text-[var(--mute)]">sec</span>
                    <span className="flex-1" />
                    <SubmitButton className="btn sm">Save</SubmitButton>
                  </div>
                </form>
              ) : (
                <>
                  <p className="text-[11px] leading-snug flex-1">{scene.prompt}</p>
                  {scene.text && <p className="text-[11px] font-semibold">“{scene.text}”</p>}
                  <p className="font-mono text-[10px] text-[var(--mute)]">{scene.seconds}s · {scene.status}</p>
                  {scene.outputUrl && (
                    <video src={scene.outputUrl} controls preload="none" className="w-full rounded-lg border border-[var(--line)]" />
                  )}
                </>
              )}
              {editable && scenes.length > 1 && (
                <form action={deleteSceneAction}>
                  <input type="hidden" name="id" value={render.id} />
                  <input type="hidden" name="index" value={i} />
                  <button className="btn sm w-full" title={`Delete scene ${i + 1}`}><Trash2 className="w-3 h-3" /> Remove</button>
                </form>
              )}
            </div>
          </div>
        ))}

        {editable && scenes.length < 6 && (
          <form action={addSceneAction} className="card border-dashed flex flex-col gap-2 justify-center" style={{ borderStyle: "dashed" }}>
            <input type="hidden" name="id" value={render.id} />
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--mute)]"><Plus className="w-4 h-4" /> Add scene</div>
            <textarea name="prompt" rows={3} placeholder="Visual prompt…" className="w-full text-[11px]" />
            <input name="text" placeholder="on-screen text" className="w-full text-[11px]" />
            <div><SubmitButton className="btn sm">Add</SubmitButton></div>
          </form>
        )}
      </div>

      {/* Full video — the deliverable for a multi-scene board */}
      {render.status === "done" && scenes.length > 1 && (
        <div className="card mb-4">
          <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5">
            <Film className="w-4 h-4" /> Full video
          </h2>
          {render.assembledUrl ? (
            <>
              <video src={render.assembledUrl} controls className="w-full max-w-sm rounded-xl border border-[var(--line)]" />
              <p className="text-[11px] text-[var(--mute)] mt-1.5">
                All {renderedClips} clips stitched into one file
                {render.voiceoverUrl ? ", narration muxed over the cut where available" : ""}. Captions stay a
                separate SRT sidecar — they are not burned in.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <a href={render.assembledUrl} download className="btn sm"><Download className="w-3.5 h-3.5" /> Download</a>
                {editor && (
                  <form action={assembleRenderAction}>
                    <input type="hidden" name="id" value={render.id} />
                    <SubmitButton className="btn sm" pendingText="Assembling…">Re-assemble</SubmitButton>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--mute)]">
                {render.assemblyStatus === "unavailable"
                  ? "This deployment has no ffmpeg binary, so the clips can't be stitched here. Per-scene clips above are unaffected."
                  : render.assemblyStatus === "failed"
                    ? "Assembly failed — the render itself is fine and every scene above still plays."
                    : renderedClips > 1
                      ? "The scenes rendered as separate clips. Assemble them into one file to download or upload."
                      : "Assembly needs at least two rendered scenes."}
              </p>
              {render.assemblyError && (
                <p className="text-[11px] mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                  {render.assemblyError}
                </p>
              )}
              {/* Offered even after "unavailable": that status is a snapshot of
                  the deploy that tried, and a later one may well have ffmpeg. */}
              {editor && renderedClips > 1 && (
                <div className="mt-2">
                  <form action={assembleRenderAction}>
                    <input type="hidden" name="id" value={render.id} />
                    <SubmitButton className="btn primary" pendingText="Assembling… (encodes every clip)">
                      <Film className="w-4 h-4" /> {render.assemblyStatus ? "Try assembly again" : "Assemble full video"}
                    </SubmitButton>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Output — single-clip boards; multi-scene clips already play per scene */}
      {render.status === "done" && scenes.length <= 1 && (render.storedUrl || render.outputUrl) && (
        <div className="card mb-4">
          <h2 className="font-mono text-[13px] font-bold mb-2">Output</h2>
          <video src={render.storedUrl ?? render.outputUrl!} controls className="w-full max-w-sm rounded-xl border border-[var(--line)]" />
          <p className="text-[11px] text-[var(--mute)] mt-1.5">
            {render.storedUrl
              ? "Persisted to storage — safe from provider URL expiry."
              : render.provider === "veo"
                ? "⚠ Provider URL only — Veo links expire in ~2 days and this one couldn't be persisted."
                : "Mock sample output (no cost)."}
          </p>
        </div>
      )}

      {render.voiceoverUrl && (
        <div className="card mb-4">
          <h2 className="font-mono text-[13px] font-bold mb-1">Voiceover</h2>
          {render.voiceoverUrl.endsWith(".txt") || render.voiceoverUrl.includes("voiceover-script") ? (
            <p className="text-xs text-[var(--mute)]">
              Mock TTS — the narration script is stored as text (<a href={render.voiceoverUrl} className="underline">view</a>).
              Configure ElevenLabs under <Link href="/admin/api-keys" className="underline">Admin → API keys</Link> for real audio.
            </p>
          ) : (
            <audio src={render.voiceoverUrl} controls className="w-full max-w-sm" />
          )}
        </div>
      )}

      {render.srt && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">Captions (SRT)</summary>
          <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap p-2 rounded-lg" style={{ background: "var(--panel)" }}>{render.srt}</pre>
          <p className="text-[11px] text-[var(--mute)] mt-1">Timed from scene durations — paste into YouTube or burn in at assembly.</p>
        </details>
      )}
    </main>
  );
}
