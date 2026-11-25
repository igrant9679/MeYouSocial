import { AutoRefresh } from "@/components/AutoRefresh";
import { EXTENDED_MAX_SECONDS, FRAMED_MAX_SECONDS, SCENE_SECONDS } from "@/lib/captions";
import { readJson } from "@/lib/db/json";
import { storage } from "@/lib/storage";
import Link from "next/link";
import { ArrowLeft, Captions, Clapperboard, Download, Film, Mic, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { elsewhereOr404 } from "@/lib/record-elsewhere";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/SubmitButton";
import { parseScenes } from "@/lib/captions";
import {
  addReferenceImageAction,
  addSceneAction,
  assembleRenderAction,
  deleteSceneAction,
  generateSrtAction,
  generateVoiceoverAction,
  processRenderNowAction,
  rerenderSceneAction,
  retryRenderAction,
  cancelRenderAction,
  removeReferenceImageAction,
  setSceneFrameAction,
  updateSceneAction,
  extendSceneAction,
} from "@/app/actions/videos";
import { AiAssist } from "@/components/AiAssist";
import { Banner } from "@/components/SocialPostCard";
import { jobs } from "@/lib/jobs";
import { VIDEO_EXTEND_JOB, VIDEO_RENDER_JOB } from "@/lib/jobs/video-render";
import { boardProgress, SCENE_STATE_LABEL, sceneState, type SceneState } from "@/lib/video-progress";
import { estimate, monthSpend, perSecondUsd, scenesToPay, usd, videoPrices } from "@/lib/video-spend";
import { PAID_VIDEO_PROVIDERS, VIDEO_MODEL } from "@/lib/video";

const SCENE_STATE_COLOR: Record<SceneState, string> = { done: "var(--green-on)", rendering: "var(--blue-on)", extending: "var(--blue-on)", next: "var(--amber-on)", waiting: "var(--mute)", interrupted: "var(--rose-on)" };

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
  "linear-gradient(135deg,var(--blue),var(--teal))",
  "linear-gradient(135deg,var(--violet),var(--pink))",
  "linear-gradient(135deg,var(--amber),var(--brand))",
  "linear-gradient(135deg,var(--green),var(--cyan))",
  "linear-gradient(135deg,var(--indigo),var(--purple))",
  "linear-gradient(135deg,var(--pink),var(--amber))",
];

export default async function StoryboardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flash?: string; flashErr?: string; confirmRender?: string; confirmExtend?: string; s?: string; d?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspace, membership } = await requireMembership();
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render) return elsewhereOr404(`/videos/${id}`);
  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const scenes = parseScenes(render.scenes);
  const renderedClips = scenes.filter((s) => s.outputUrl).length;
  const editable = editor && (render.status === "queued" || render.status === "failed");
  const hue = STATUS_HUE[render.status] ?? "cyan";
  const post = render.blogPostId
    ? await db.blogPost.findUnique({ where: { id: render.blogPostId }, select: { id: true, title: true } })
    : null;
  // E-VID-07: where the board is, scene by scene, and the background render's own end.
  const progress = boardProgress(render.status, scenes);
  const job = await jobs.latestFor(VIDEO_RENDER_JOB, render.id);
  const jobActive = job?.state === "queued" || job?.state === "running";
  // Extend (2026-11-24): a clip being continued keeps the page refreshing until the longer one lands.
  const extendJob = await jobs.latestFor(VIDEO_EXTEND_JOB, render.id);
  const extending = scenes.some((s) => s.status === "extending") || extendJob?.state === "queued" || extendJob?.state === "running";
  const confirmIndex = sp.confirmExtend != null ? parseInt(sp.confirmExtend, 10) : NaN;
  const confirmScene = Number.isFinite(confirmIndex) ? scenes[confirmIndex] : undefined;
  const confirmSeconds = Math.min(10, Math.max(3, parseInt(sp.s ?? "6", 10) || 6));
  const extendChoices = (scene: (typeof scenes)[number]) => [4, 6, 8, 10].filter((n) => scene.seconds + n <= EXTENDED_MAX_SECONDS);
  const rerenderable = editor && (render.status === "done" || render.status === "failed");
  // E-VID-06: what a render would cost before it's spent — at the operator's price, or seconds and a dash.
  const [prices, spend] = await Promise.all([videoPrices(), monthSpend(workspace.id)]);
  const perSecond = prices[VIDEO_MODEL] ?? null;
  const owed = estimate(scenes.length ? scenesToPay(scenes) : [{ seconds: render.seconds }], VIDEO_MODEL, prices);
  const boardUsd = render.costEstimate ?? (perSecond == null ? null : Math.round(render.seconds * perSecond * 100) / 100);
  // Pictures the board is made from (2026-11-24, Gemini Omni Flash): its reference images, and Media's pictures to pick from.
  const refKeys = readJson<string[]>(render.referenceKeys, []);
  const mediaPictures = editable
    ? await db.mediaItem.findMany({ where: { workspaceId: workspace.id, contentType: { startsWith: "image/" } }, orderBy: { createdAt: "desc" }, take: 40, select: { key: true, name: true } })
    : [];
  const maxSceneSeconds = (framed: boolean) => Math.min(Math.max(4, env.VIDEO_MAX_SECONDS), framed ? FRAMED_MAX_SECONDS : Infinity);
  const pictureFields = (
    <>
      <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="text-2xs max-w-full" aria-label="Upload a picture" />
      {mediaPictures.length > 0 && (
        <select name="mediaKey" defaultValue="" className="text-2xs max-w-full" aria-label="Or pick a picture from Media">
          <option value="">— or pick from Media —</option>
          {mediaPictures.map((m) => <option key={m.key} value={m.key}>{m.name.slice(0, 60)}</option>)}
        </select>
      )}
    </>
  );

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
            {render.aspect} · {render.seconds}s total · {boardUsd != null ? <>about {usd(boardUsd)} at the operator&apos;s price</> : <span title="No price per second is set for this model — the platform operator sets one on Usage">no price set</span>} · provider {render.provider}
            {post && <> · from <Link href={`/blog/${post.id}`} className="underline">{post.title}</Link></>}
          </p>
        </div>
        <span className="font-mono text-2xs font-bold px-2.5 py-1 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
          {render.status}
        </span>
      </div>
      {sp.flash && <Banner kind="ok" text={sp.flash} />}
      {sp.flashErr && <Banner kind="err" text={sp.flashErr} />}
      {(progress.line || jobActive) && (
        <p className="font-mono text-2xs mb-2" style={{ color: `var(--${hue}-on)` }} data-render-progress>
          {progress.line || "Starting…"}
          {jobActive && render.status === "queued" ? " · Render now is starting it" : ""}
          {progress.total > 1 && (render.status === "rendering" || render.status === "queued") && (
            <span className="inline-block align-middle ml-2 w-28 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }} aria-hidden>
              <span className="block h-full" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, background: `var(--${hue})` }} />
            </span>
          )}
        </p>
      )}
      {render.error && (
        <p className="text-xs mb-2 px-3 py-2 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          {render.error}
        </p>
      )}
      {job?.state === "failed" && job.error && render.status !== "done" && (
        <p className="text-xs mb-2 px-3 py-2 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} data-render-job-failed>
          The background render stopped: {job.error.slice(0, 300)}
        </p>
      )}

      {/* E-VID-06: cost before spending — the total, the month so far, the budget, then Render. */}
      {sp.confirmRender && render.status === "queued" && admin && !jobActive && (
        <div id="render-confirm" className="card mb-4 scroll-mt-20" style={{ borderColor: spend.budget != null && spend.seconds + owed.seconds > spend.budget ? "var(--rose)" : "var(--amber)" }} data-render-confirm>
          <p className="text-sm m-0 mb-1">
            Render <b>{owed.clips} scene{owed.clips === 1 ? "" : "s"}</b> — <b className="font-mono">{owed.seconds} seconds</b> of video with <span className="font-mono">{VIDEO_MODEL}</span>.{" "}
            {owed.usd != null
              ? <>About <b className="font-mono" data-render-total>{usd(owed.usd)}</b> at {perSecondUsd(owed.perSecond!)} a second — the platform operator&apos;s price, an estimate, not a bill.</>
              : <>No price per second is set for this model, so this can&apos;t say what it costs — the platform operator sets one on Usage.</>}
          </p>
          <p className="text-2xs text-[var(--mute)] m-0 mb-2" data-render-month>
            This month so far: {spend.seconds} seconds{spend.usd != null ? ` (about ${usd(spend.usd)})` : ""}
            {spend.budget != null ? <> of a {spend.budget}-second budget{spend.seconds + owed.seconds > spend.budget ? <b style={{ color: "var(--rose-on)" }}> — this render goes past it</b> : null}</> : " — no monthly budget set (Usage)"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={processRenderNowAction}>
              <input type="hidden" name="id" value={render.id} />
              <input type="hidden" name="intent" value="confirmed" />
              <SubmitButton className="btn primary" pendingText="Starting…"><Play className="w-4 h-4" /> Render — {owed.seconds} s{owed.usd != null ? `, about ${usd(owed.usd)}` : ""}</SubmitButton>
            </form>
            <Link href={`/videos/${render.id}`} className="btn">Not now</Link>
          </div>
        </div>
      )}

      {/* Extend (2026-11-24): what it adds and costs, then Extend — the same rule as Render now. */}
      {confirmScene && render.status === "done" && admin && !extending && (
        <div id="extend-confirm" className="card mb-4 scroll-mt-20" style={{ borderColor: spend.budget != null && spend.seconds + confirmSeconds > spend.budget ? "var(--rose)" : "var(--amber)" }} data-extend-confirm>
          <p className="text-sm m-0 mb-1">
            Extend <b>scene {confirmIndex + 1}</b> by <b className="font-mono">{confirmSeconds} seconds</b> ({confirmScene.seconds} s → {confirmScene.seconds + confirmSeconds} s) with <span className="font-mono">{VIDEO_MODEL}</span>.{" "}
            {perSecond != null
              ? <>About <b className="font-mono" data-extend-total>{usd(confirmSeconds * perSecond)}</b> at {perSecondUsd(perSecond)} a second — the platform operator&apos;s price, an estimate, not a bill.</>
              : <>No price per second is set for this model, so this can&apos;t say what it costs — the platform operator sets one on Usage.</>}
          </p>
          {sp.d && <p className="text-2xs m-0 mb-1">Direction: “{sp.d.slice(0, 300)}”</p>}
          <p className="text-2xs text-[var(--mute)] m-0 mb-2">
            This month so far: {spend.seconds} seconds{spend.usd != null ? ` (about ${usd(spend.usd)})` : ""}
            {spend.budget != null ? <> of a {spend.budget}-second budget{spend.seconds + confirmSeconds > spend.budget ? <b style={{ color: "var(--rose-on)" }}> — this goes past it</b> : null}</> : " — no monthly budget set (Usage)"}.
            {scenes.length > 1 ? " The full video is stitched again afterwards." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={extendSceneAction}>
              <input type="hidden" name="id" value={render.id} />
              <input type="hidden" name="index" value={confirmIndex} />
              <input type="hidden" name="seconds" value={confirmSeconds} />
              <input type="hidden" name="direction" value={sp.d ?? ""} />
              <input type="hidden" name="intent" value="confirmed" />
              <SubmitButton className="btn primary" pendingText="Starting…"><Plus className="w-4 h-4" /> Extend — {confirmSeconds} s{perSecond != null ? `, about ${usd(confirmSeconds * perSecond)}` : ""}</SubmitButton>
            </form>
            <Link href={`/videos/${render.id}`} className="btn">Not now</Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {render.status === "failed" && editor && (
          <form action={retryRenderAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn"><RotateCcw className="w-4 h-4" /> Retry (re-queue)</SubmitButton>
          </form>
        )}
        {(render.status === "queued" || render.status === "rendering") && editor && (
          <form action={cancelRenderAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn" pendingText="Cancelling…">Cancel render</SubmitButton>
          </form>
        )}
        {(render.status === "queued" || render.status === "rendering" || jobActive || extending) && <AutoRefresh />}
        {render.status === "queued" && admin && !jobActive && !sp.confirmRender && (
          <form action={processRenderNowAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn primary" pendingText="…" title="Shows what it costs first, then renders in the background">
              <Play className="w-4 h-4" /> Render now
            </SubmitButton>
          </form>
        )}
        {editor && (scenes.length > 0 || !!render.voiceWords) && (
          <form action={generateSrtAction}>
            <input type="hidden" name="id" value={render.id} />
            <SubmitButton className="btn" pendingText="Generating…"><Captions className="w-4 h-4" /> {render.voiceWords && render.captionsTimedBy !== "voice" ? "Time captions to the narration" : render.srt ? "Regenerate captions" : "Generate captions"}</SubmitButton>
          </form>
        )}
        {editor && (
          <form action={generateVoiceoverAction} className="flex flex-wrap items-center gap-1.5" data-voiceover-form="">
            <input type="hidden" name="id" value={render.id} />
            {/* E-VID-08: read the script itself, or the scenes' on-screen lines. */}
            {render.scriptId && (
              <select key={`source:${render.narrationSource === "scenes" ? "scenes" : "script"}`} name="source" defaultValue={render.narrationSource === "scenes" ? "scenes" : "script"} className="text-xs" aria-label="What the narrator reads">
                <option value="script">Narrate the script</option>
                <option value="scenes">Narrate the scene lines</option>
              </select>
            )}
            <SubmitButton className="btn" pendingText="Speaking…"><Mic className="w-4 h-4" /> {render.voiceoverUrl ? "Regenerate voiceover" : "Generate voiceover"}</SubmitButton>
          </form>
        )}
      </div>

      {/* Reference images (2026-11-24): what Google's Flow calls ingredients — kept the same in every scene. */}
      {(editable || refKeys.length > 0) && (
        <div className="card mb-3" data-video-references="">
          <h2 className="font-mono text-sm font-bold mb-1">Reference images <span className="font-normal text-[var(--mute)]">· {refKeys.length} of 6</span></h2>
          <p className="text-2xs text-[var(--mute)] mb-2">
            Pictures of a person, character or product. Every scene is made to keep them looking the same. A scene with its own start image uses that instead.
            {editable ? " Changes apply to scenes not rendered yet." : ""}
          </p>
          {refKeys.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {refKeys.map((k, j) => (
                <div key={k} className="flex flex-col items-center gap-1" data-video-reference={k}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={storage.url(k)} alt={`Reference image ${j + 1}`} className="w-20 h-20 object-cover rounded-lg border border-[var(--line)]" />
                  {editable && (
                    <form action={removeReferenceImageAction}>
                      <input type="hidden" name="id" value={render.id} />
                      <input type="hidden" name="key" value={k} />
                      <button className="btn sm" title={`Remove reference image ${j + 1}`}><Trash2 className="w-3 h-3" /> Remove</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
          {editable && refKeys.length < 6 && (
            <form action={addReferenceImageAction} encType="multipart/form-data" className="flex flex-wrap items-center gap-2" data-add-reference="">
              <input type="hidden" name="id" value={render.id} />
              {pictureFields}
              <SubmitButton className="btn sm" pendingText="Adding…"><Plus className="w-3 h-3" /> Add reference</SubmitButton>
            </form>
          )}
        </div>
      )}

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
                <>
                {/* A stopped or queued board is still editable — show where each scene is, and its clip. */}
                <p className="font-mono text-micro text-[var(--mute)]" data-scene-state={sceneState(render.status, scene, i, scenes)}>
                  <span style={{ color: SCENE_STATE_COLOR[sceneState(render.status, scene, i, scenes)] }}>{SCENE_STATE_LABEL[sceneState(render.status, scene, i, scenes)]}</span>
                  {scene.status === "done" && scene.outputUrl ? " · a new prompt or length renders it again" : ""}
                  {/* E-VID-06: each clip's cost — its seconds at the operator's price. */}
                  {perSecond != null ? ` · ${scene.seconds}s ≈ ${usd(scene.seconds * perSecond)}${scene.status === "done" && scene.outputUrl ? " (paid)" : ""}` : ""}
                </p>
                {scenes.length > 1 && scene.outputUrl && (
                  <video src={scene.outputUrl} controls preload="none" className="w-full rounded-lg border border-[var(--line)]" />
                )}
                <form action={updateSceneAction} className="flex flex-col gap-2 flex-1">
                  <input type="hidden" name="id" value={render.id} />
                  <input type="hidden" name="index" value={i} />
                  <textarea name="prompt" defaultValue={scene.prompt} rows={4} className="w-full text-2xs" aria-label={`Scene ${i + 1} prompt`} />
                  <AiAssist field="scene.prompt" target="prompt" label="Draft" className="!mt-0" />
                  <input name="text" defaultValue={scene.text ?? ""} placeholder="on-screen text (≤8 words)" className="w-full text-2xs" />
                  <div className="flex items-center gap-2">
                    {/* Gemini Omni Flash renders 3–15 seconds, 10 at most when the scene starts on a picture (VID-11). */}
                    <select key={`seconds:${scene.seconds}`} name="seconds" defaultValue={scene.seconds} className="w-16 font-mono text-2xs" aria-label="Seconds">
                      {SCENE_SECONDS.filter((s) => s <= maxSceneSeconds(!!scene.firstFrameKey)).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="text-micro text-[var(--mute)]">sec</span>
                    <span className="flex-1" />
                    <SubmitButton className="btn sm">Save</SubmitButton>
                  </div>
                </form>
                {/* Start / end picture (2026-11-24): the scene begins — and ends — exactly on these. */}
                <details className="text-2xs" open={!!scene.firstFrameKey} data-scene-frames={i}>
                  <summary className="cursor-pointer text-[var(--mute)]">Start / end picture{scene.firstFrameKey ? (scene.lastFrameKey ? " · both set" : " · start set") : ""}</summary>
                  <p className="text-micro text-[var(--mute)] my-1">The scene starts exactly on the start picture, and ends on the end picture if you add one. Up to {FRAMED_MAX_SECONDS} seconds.</p>
                  {(["first", "last"] as const).map((which) => {
                    const key = which === "first" ? scene.firstFrameKey : scene.lastFrameKey;
                    if (which === "last" && !scene.firstFrameKey) return null;
                    return key ? (
                      <div key={which} className="flex items-center gap-2 mb-1" data-scene-frame={which}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={storage.url(key)} alt={`Scene ${i + 1} ${which === "first" ? "start" : "end"} picture`} className="w-12 h-12 object-cover rounded border border-[var(--line)]" />
                        <span className="flex-1">{which === "first" ? "Start" : "End"}</span>
                        <form action={setSceneFrameAction}>
                          <input type="hidden" name="id" value={render.id} />
                          <input type="hidden" name="index" value={i} />
                          <input type="hidden" name="which" value={which} />
                          <input type="hidden" name="clear" value="1" />
                          <button className="btn sm" title={`Remove the ${which === "first" ? "start" : "end"} picture`}>Remove</button>
                        </form>
                      </div>
                    ) : (
                      <form key={which} action={setSceneFrameAction} encType="multipart/form-data" className="flex flex-col gap-1 mb-1" data-set-scene-frame={which}>
                        <input type="hidden" name="id" value={render.id} />
                        <input type="hidden" name="index" value={i} />
                        <input type="hidden" name="which" value={which} />
                        {pictureFields}
                        <div><SubmitButton className="btn sm" pendingText="Saving…">{which === "first" ? "Set start picture" : "Set end picture"}</SubmitButton></div>
                      </form>
                    );
                  })}
                </details>
                {rerenderable && scenes.length > 1 && scene.status === "done" && scene.outputUrl && (
                  <form action={rerenderSceneAction}>
                    <input type="hidden" name="id" value={render.id} />
                    <input type="hidden" name="index" value={i} />
                    <SubmitButton className="btn sm w-full" pendingText="Queuing…" title="Reset this scene and queue the board; the other clips are kept and not paid for again">
                      <RotateCcw className="w-3 h-3" /> Render this scene again
                    </SubmitButton>
                  </form>
                )}
                </>
              ) : (
                <>
                  <p className="text-2xs leading-snug flex-1">{scene.prompt}</p>
                  {scene.text && <p className="text-2xs font-semibold">“{scene.text}”</p>}
                  {scene.firstFrameKey && (
                    <div className="flex items-center gap-1.5 text-micro text-[var(--mute)]" data-scene-frame-view={i}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={storage.url(scene.firstFrameKey)} alt={`Scene ${i + 1} start picture`} className="w-10 h-10 object-cover rounded border border-[var(--line)]" />
                      {scene.lastFrameKey && (
                        <>
                          →
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={storage.url(scene.lastFrameKey)} alt={`Scene ${i + 1} end picture`} className="w-10 h-10 object-cover rounded border border-[var(--line)]" />
                        </>
                      )}
                      <span>{scene.lastFrameKey ? "starts and ends on these" : "starts on this"}</span>
                    </div>
                  )}
                  {(() => {
                    const st = sceneState(render.status, scene, i, scenes);
                    return (
                      <p className="font-mono text-micro text-[var(--mute)]" data-scene-state={st}>
                        {scene.seconds}s{perSecond != null ? ` (${usd(scene.seconds * perSecond)})` : ""} ·{" "}
                        <span style={{ color: SCENE_STATE_COLOR[st] }}>{SCENE_STATE_LABEL[st]}</span>
                      </p>
                    );
                  })()}
                  {scenes.length > 1 && scene.outputUrl && (
                    <video src={scene.outputUrl} controls preload="none" className="w-full rounded-lg border border-[var(--line)]" />
                  )}
                  {rerenderable && scenes.length > 1 && scene.status === "done" && scene.outputUrl && (
                    <form action={rerenderSceneAction}>
                      <input type="hidden" name="id" value={render.id} />
                      <input type="hidden" name="index" value={i} />
                      <SubmitButton className="btn sm w-full" pendingText="Queuing…" title="Reset this scene and queue the board; the other clips are kept and not paid for again">
                        <RotateCcw className="w-3 h-3" /> Render this scene again
                      </SubmitButton>
                    </form>
                  )}
                  {/* Extend (2026-11-24): continue the clip Google made — a few seconds at a time, up to 30. */}
                  {scene.extendError && scene.status !== "extending" && (
                    <p className="text-micro px-2 py-1 rounded" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} data-extend-error={i}>Couldn&apos;t extend: {scene.extendError}</p>
                  )}
                  {admin && render.status === "done" && PAID_VIDEO_PROVIDERS.has(render.provider) && scene.status === "done" && scene.outputUrl && !extending && (
                    scene.ref && extendChoices(scene).length > 0 ? (
                      <details className="text-2xs" data-extend={i}>
                        <summary className="cursor-pointer text-[var(--mute)]">Extend this clip{scene.extended ? " again" : ""}</summary>
                        <form action={extendSceneAction} className="flex flex-col gap-1 mt-1">
                          <input type="hidden" name="id" value={render.id} />
                          <input type="hidden" name="index" value={i} />
                          <div className="flex items-center gap-1.5">
                            <span>by</span>
                            <select name="seconds" defaultValue={extendChoices(scene)[Math.min(1, extendChoices(scene).length - 1)]} className="w-16 font-mono text-2xs" aria-label="Seconds to add">
                              {extendChoices(scene).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <span>s · up to {EXTENDED_MAX_SECONDS} s in all</span>
                          </div>
                          <input name="direction" maxLength={300} placeholder="What happens next (optional)" className="w-full text-2xs" />
                          <div><SubmitButton className="btn sm" pendingText="…"><Plus className="w-3 h-3" /> Extend…</SubmitButton></div>
                        </form>
                      </details>
                    ) : (
                      <p className="text-micro text-[var(--mute)]" data-extend-unavailable={i}>
                        {scene.ref ? `At ${EXTENDED_MAX_SECONDS} seconds — as long as a scene can be.` : "Made before clips could be continued — render it again to extend it."}
                      </p>
                    )
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
            <textarea name="prompt" rows={3} placeholder="Visual prompt…" className="w-full text-2xs" />
            <AiAssist field="scene.prompt" target="prompt" label="Draft" className="!mt-0" />
            <input name="text" placeholder="on-screen text" className="w-full text-2xs" />
            <div><SubmitButton className="btn sm">Add</SubmitButton></div>
          </form>
        )}
      </div>

      {/* Full video — the deliverable for a multi-scene board */}
      {render.status === "done" && scenes.length > 1 && (
        <div className="card mb-4">
          <h2 className="font-mono text-sm font-bold mb-2 flex items-center gap-1.5">
            <Film className="w-4 h-4" /> Full video
          </h2>
          {render.assembledUrl ? (
            <>
              <video src={render.assembledUrl} controls className="w-full max-w-sm rounded-xl border border-[var(--line)]" />
              <p className="text-2xs text-[var(--mute)] mt-1.5">
                All {renderedClips} clips stitched into one file
                {render.voiceoverUrl ? ", narration muxed over the cut where available" : ""}.{" "}
                {render.captionsBurned ? "Captions are burned into the picture." : "Captions stay separate SRT/VTT files — tick Burn captions in and re-assemble to draw them into the picture."}
              </p>
              {/* A burn that failed leaves the cut without captions and says why (E-VID-08). */}
              {render.assemblyError && (
                <p className="text-2xs mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }} data-burn-note="">
                  {render.assemblyError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <a href={render.assembledUrl} download className="btn sm"><Download className="w-3.5 h-3.5" /> Download</a>
                {editor && (
                  <form action={assembleRenderAction} className="flex items-center gap-1.5" data-assemble-form="">
                    <input type="hidden" name="id" value={render.id} />
                    <input type="hidden" name="burnChoice" value="1" />
                    <label className="inline-flex items-center gap-1 text-2xs" title={render.srt ? "Draw the captions into the picture" : "Generate captions first"}>
                      <input type="checkbox" name="burn" defaultChecked={render.burnCaptions} disabled={!render.srt} /> Burn captions in
                    </label>
                    <SubmitButton className="btn sm" pendingText="Assembling…">Re-assemble</SubmitButton>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--mute)]">
                {render.provider === "mock"
                  ? "These are the mock provider's sample clips, so there's nothing to stitch — a real render (with a video key) assembles itself."
                  : render.assemblyStatus === "unavailable"
                  ? "This deployment has no ffmpeg binary, so the clips can't be stitched here. Per-scene clips above are unaffected."
                  : render.assemblyStatus === "failed"
                    ? "Assembly failed — the render itself is fine and every scene above still plays."
                    : renderedClips > 1
                      ? "The scenes rendered as separate clips. Assemble them into one file to download or upload."
                      : "Assembly needs at least two rendered scenes."}
              </p>
              {render.assemblyError && (
                <p className="text-2xs mt-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                  {render.assemblyError}
                </p>
              )}
              {/* Offered even after "unavailable": that status is a snapshot of
                  the deploy that tried, and a later one may well have ffmpeg. */}
              {editor && renderedClips > 1 && render.provider !== "mock" && (
                <div className="mt-2">
                  <form action={assembleRenderAction} className="flex flex-wrap items-center gap-2" data-assemble-form="">
                    <input type="hidden" name="id" value={render.id} />
                    <input type="hidden" name="burnChoice" value="1" />
                    <label className="inline-flex items-center gap-1 text-2xs" title={render.srt ? "Draw the captions into the picture" : "Generate captions first"}>
                      <input type="checkbox" name="burn" defaultChecked={render.burnCaptions} disabled={!render.srt} /> Burn captions in
                    </label>
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
          <h2 className="font-mono text-sm font-bold mb-2">Output</h2>
          <video src={render.storedUrl ?? render.outputUrl!} controls className="w-full max-w-sm rounded-xl border border-[var(--line)]" />
          <p className="text-2xs text-[var(--mute)] mt-1.5">
            {render.storedUrl
              ? "Persisted to storage — safe from provider URL expiry."
              : PAID_VIDEO_PROVIDERS.has(render.provider)
                ? "⚠ Provider URL only — Google's video links expire in ~2 days and this one couldn't be persisted."
                : "Mock sample output (no cost)."}
          </p>
          {rerenderable && (
            <form action={rerenderSceneAction} className="mt-2">
              <input type="hidden" name="id" value={render.id} />
              <input type="hidden" name="index" value={0} />
              <SubmitButton className="btn sm" pendingText="Queuing…" title="Queue this clip to render again"><RotateCcw className="w-3 h-3" /> Render again</SubmitButton>
            </form>
          )}
        </div>
      )}

      {render.voiceoverUrl && (
        <div className="card mb-4">
          <h2 className="font-mono text-sm font-bold mb-1">Voiceover</h2>
          {render.voiceoverUrl.endsWith(".txt") || render.voiceoverUrl.includes("voiceover-script") ? (
            <p className="text-xs text-[var(--mute)]">
              Mock TTS — the narration script is stored as text (<a href={render.voiceoverUrl} className="underline">view</a>).
              Configure ElevenLabs under <Link href="/admin/api-keys" className="underline">Settings → Keys</Link> for real audio.
            </p>
          ) : (
            <>
              <audio src={render.voiceoverUrl} controls className="w-full max-w-sm" />
              <p className="text-2xs text-[var(--mute)] mt-1" data-voice-note="">
                Read from {render.narrationSource === "script" ? "the script" : "the scene lines"}
                {render.voiceId ? <> · voice <span className="font-mono">{render.voiceId}</span></> : null}
                {render.voiceWords ? " · timed word by word, so captions can follow it" : ""}.
              </p>
            </>
          )}
        </div>
      )}

      {render.srt && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">Captions</summary>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <a href={`/videos/${render.id}/captions?format=srt`} className="btn sm" data-captions-download="srt"><Download className="w-3.5 h-3.5" /> .srt</a>
            <a href={`/videos/${render.id}/captions?format=vtt`} className="btn sm" data-captions-download="vtt"><Download className="w-3.5 h-3.5" /> .vtt</a>
            <span className="text-2xs text-[var(--mute)]" data-captions-timing={render.captionsTimedBy ?? "scenes"}>
              {render.captionsTimedBy === "voice" ? "Timed to the narration, word by word." : "Timed from scene durations."}
              {render.captionsTimedBy !== "voice" && render.voiceWords ? " Regenerate captions to time them to the narration." : ""}
            </span>
          </div>
          <pre className="mt-2 text-2xs font-code whitespace-pre-wrap p-2 rounded-lg" style={{ background: "var(--panel)" }}>{render.srt}</pre>
          <p className="text-2xs text-[var(--mute)] mt-1">Upload either file to YouTube, or burn them into the picture when you assemble.</p>
        </details>
      )}
    </main>
  );
}
