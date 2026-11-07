import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { ArrowLeft, Tag, Hash, GitBranch, FileText, BookOpen, ListChecks, Check, SquarePlay } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatBytes } from "@/lib/documents/kinds";
import { getPostingTimeZone } from "@/lib/social/slots";
import { youtubeOauthConnected } from "@/lib/youtube/oauth";
import { projectUploadSources } from "@/lib/youtube/upload-sources";
import { confirmYoutubeUploadAction, startYoutubeUploadAction, youtubeUploadStepAction } from "@/app/actions/youtube-upload";
import { confirmThumbnailTestAction, startThumbnailTestAction, thumbnailTestStepAction } from "@/app/actions/thumbnail-test";
import { readJsonOr, type TestWindow, type Variant, type Verdict } from "@/lib/youtube/thumbnail-test";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import {
  setProjectMeritAction,
  setProjectKeywordsAction,
  repurposeProjectAction,
} from "@/app/actions/growth";
import { setProjectStatusAction, setProjectPublishDateAction, setUploadStepAction, linkYoutubeVideoAction, unlinkYoutubeVideoAction } from "@/app/actions/production";
import { cachedYoutubeAudit } from "@/lib/youtube/analytics";
import { suggestUploads, watchUrl } from "@/lib/youtube/video-link";
import { UPLOAD_STEPS, readChecklist, checklistDone } from "@/lib/upload-checklist";
import { attachChecklistAction } from "@/app/actions/final-pass";
import { formatDay, formatZonedMoment } from "@/lib/zoned-dates";

const STATUS_LABEL: Record<string, string> = {
  idea: "Idea", research_writing: "Research/Writing", recording: "Recording", editing: "Editing", scheduled: "Scheduled", published: "Published",
};

const MERIT_COLOR: Record<string, { color: string; soft: string }> = {
  pillar:     { color: "var(--green)", soft: "var(--green-soft)" },
  trending:   { color: "var(--brand)", soft: "var(--brand-soft)" },
  experiment: { color: "var(--violet)", soft: "var(--violet-soft)" },
};

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { workspace, membership } = await requireMembership();
  // Viewers read the project; every control on it is an editor's (E-VID-12).
  const editor = canEdit(membership.role);
  const project = await db.contentProject.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: {
      channel: { select: { id: true, name: true, accentColor: true } },
      script: { select: { id: true, title: true, wordCount: true, status: true } },
      parent: { select: { id: true, title: true } },
      derivatives: { select: { id: true, title: true, format: true, status: true } },
      assignees: { include: { user: { select: { name: true, email: true } } } },
      tasks: { orderBy: { dueDate: { sort: "asc", nulls: "last" } } },
    },
  });
  if (!project) notFound();
  // E-VID-03: what can go to YouTube, and how earlier uploads went — admins only.
  const admin = canAdmin(membership.role);
  const [uploads, ytLink, uploadSources, tz, scriptOutline] = admin
    ? await Promise.all([
        db.youtubeUpload.findMany({ where: { workspaceId: workspace.id, projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5 }),
        youtubeOauthConnected(workspace.id),
        projectUploadSources(workspace.id, project.id, project.scriptId),
        getPostingTimeZone(workspace.id),
        project.scriptId ? db.script.findUnique({ where: { id: project.scriptId }, select: { outline: true } }) : Promise.resolve(null),
      ])
    : [[], { connected: false, channel: "" }, { videos: [], images: [] }, "UTC", null] as const;
  const ytConnected = ytLink.connected;
  // E-VID-05: the video's thumbnail tests, newest first.
  const thumbTests = admin && project.youtubeVideoId
    ? await db.thumbnailTest.findMany({ where: { workspaceId: workspace.id, projectId: project.id }, orderBy: { createdAt: "desc" }, take: 3 })
    : [];
  const ytChannel = ytLink.channel;
  const pkg = readJson<{ publish?: Record<string, string> }>(scriptOutline?.outline ?? null, {}).publish ?? {};
  const uploadDefaults = {
    title: (pkg.title ?? project.title).slice(0, 100),
    description: [pkg.description ?? "", pkg.chapters ?? ""].filter(Boolean).join("\n\n").slice(0, 4900),
    tags: pkg.tags ? pkg.tags.split(/[,\n]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean).join(", ") : readJson<string[]>(project.keywords, []).join(", "),
    chaptersNote: pkg.chapters ? "The chapters come from the script's publishing package, timed from its words — check them against the final cut." : "",
  };

  // VID-08: no production numbers are shown, so none are read.
  const wikiDocs = editor ? await db.wikiDoc.findMany({
    where: { workspaceId: workspace.id, OR: [{ channelId: null }, { channelId: project.channelId }] },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, checklist: true },
  }) : [];

  // Upload checklist (E-VID-04): who ticked each step, and — a hint, never a
  // tick — whether the Thumbnail Studio has made anything for this script.
  const checklist = readChecklist(project.uploadChecklist);
  const done = checklistDone(checklist);
  const tickers = [...new Set(Object.values(checklist).map((t) => t.by).filter(Boolean))];
  const [tickedBy, studioThumbs] = await Promise.all([
    tickers.length
      ? db.user.findMany({ where: { id: { in: tickers }, memberships: { some: { workspaceId: workspace.id } } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    project.scriptId ? db.thumbnail.count({ where: { scriptId: project.scriptId } }) : Promise.resolve(0),
  ]);
  const nameOf = new Map(tickedBy.map((u) => [u.id, u.name ?? u.email ?? "someone"]));

  // Its YouTube upload (E-MEA-17): the stored audit only — never a live fetch
  // on a page view — for the linked video's numbers and for suggestions.
  const audit = await cachedYoutubeAudit(workspace.id, 90).catch(() => ({ state: "none" as const }));
  const auditVideos = audit.state === "ok" ? audit.audit.videos : [];
  const linked = project.youtubeVideoId ? auditVideos.find((v) => v.id === project.youtubeVideoId) ?? null : null;
  const suggestions = editor && !project.youtubeVideoId && auditVideos.length
    ? suggestUploads(project.title, auditVideos, new Set(
        (await db.contentProject.findMany({ where: { channel: { workspaceId: workspace.id }, youtubeVideoId: { not: null } }, select: { youtubeVideoId: true } }))
          .map((p) => p.youtubeVideoId!),
      ))
    : [];

  const keywords = readJson<string[]>(project.keywords, []);

  // task grouping under projects with progress rollup
  const tasksDone = project.tasks.filter((t) => t.status === "done").length;
  const tasksProgress = project.tasks.length > 0 ? Math.round((tasksDone / project.tasks.length) * 100) : 0;

  return (
    <div>
      <Link href="/production" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Production board</Link>

      {/* Header */}
      <div className="card mb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold" style={{ background: project.channel.accentColor ?? "var(--accent)" }}>{project.channel.name.slice(0, 2).toUpperCase()}</span>
          <div className="flex-1">
            <h1 className="font-mono font-bold text-2xl leading-tight">{project.title}</h1>
            <div className="text-xs text-[var(--mute)] flex items-center gap-2">
              <span className="font-mono uppercase tracking-wider">{STATUS_LABEL[project.status] ?? project.status}</span>
              {project.editStatus && <span>· edit: {project.editStatus.replace("_", " ")}</span>}
              {project.format && <span>· {project.format}</span>}
              <span>· {project.channel.name}</span>
            </div>
          </div>
          {project.script && (
            <Link href={`/scripts/${project.script.id}`} className="btn sm flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Script</Link>
          )}
        </div>

        {project.parent && (
          <div className="text-xs text-[var(--mute)] flex items-center gap-1 mt-2">
            <GitBranch className="w-3 h-3" /> Repurposed from <Link href={`/production/projects/${project.parent.id}`} className="text-[var(--accent)] font-semibold">{project.parent.title}</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status + publish date */}
        <section className="card">
          <h2 className="font-mono font-bold text-sm mb-3">Status & schedule</h2>
          {!editor ? (
            <dl className="m-0 grid grid-cols-2 gap-2 text-sm" data-read-only>
              <div><dt className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Status</dt><dd className="m-0">{STATUS_LABEL[project.status] ?? project.status}</dd></div>
              <div><dt className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Target publish</dt><dd className="m-0">{project.publishDate ? formatDay(new Date(project.publishDate)) : "—"}</dd></div>
            </dl>
          ) : (<>
          <form action={setProjectStatusAction} className="flex items-end gap-2 mb-3">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Status</span>
              <select key={`status:${project.status}`} name="status" defaultValue={project.status} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
          <form action={setProjectPublishDateAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Target publish</span>
              <input type="date" name="publishDate" defaultValue={project.publishDate ? new Date(project.publishDate).toISOString().slice(0, 10) : ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
          </>)}
        </section>

        {/* Upload checklist (E-VID-04) */}
        <section className="card" data-upload-checklist>
          <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2">
            <ListChecks className="w-4 h-4" style={{ color: "var(--green)" }} /> Upload checklist
            <span className="text-xs text-[var(--mute)] font-normal" data-upload-done>{done}/{UPLOAD_STEPS.length}</span>
          </h2>
          <ol className="m-0 p-0 list-none">
            {UPLOAD_STEPS.map((s) => {
              const tick = checklist[s.key];
              const box = (
                <span className="w-5 h-5 rounded-md border grid place-items-center shrink-0"
                  style={tick ? { background: "var(--green)", borderColor: "var(--green)", color: "white" } : { borderColor: "var(--line-2)" }}>
                  {tick && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                </span>
              );
              return (
                <li key={s.key} className="border-t border-[var(--line)] first:border-t-0 py-1.5 text-sm flex items-center gap-2" data-step={s.key} data-done={tick ? "1" : "0"}>
                  {editor ? (
                    <form action={setUploadStepAction}>
                      <input type="hidden" name="id" value={project.id} />
                      <input type="hidden" name="step" value={s.key} />
                      <input type="hidden" name="done" value={tick ? "0" : "1"} />
                      <button type="submit" className="grid place-items-center" aria-label={tick ? `Untick ${s.label}` : `Tick ${s.label}`} title={tick ? "Untick" : "Tick"}>{box}</button>
                    </form>
                  ) : box}
                  <span className={"flex-1 " + (tick ? "text-[var(--mute)]" : "")}>{s.label}</span>
                  {tick ? (
                    <span className="text-micro text-[var(--mute)] text-right">{nameOf.get(tick.by) ?? "someone"} · {formatDay(new Date(tick.at))}</span>
                  ) : s.key === "thumbnail" && studioThumbs > 0 ? (
                    <Link href="/thumbnails" className="text-micro text-[var(--accent)]" data-thumb-hint>{studioThumbs} made in the studio →</Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {done === UPLOAD_STEPS.length && project.status !== "published" && (
            <p className="text-2xs text-[var(--mute)] mt-2 mb-0" data-upload-nudge>Every step is ticked — {editor ? "set the status to Published when it's live." : "an editor can mark it Published."}</p>
          )}
        </section>

        {/* Its YouTube upload (E-MEA-17) */}
        <section className="card" id="youtube" data-youtube-link>
          <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2">
            <SquarePlay className="w-4 h-4" style={{ color: "var(--rose)" }} /> YouTube video
          </h2>
          {(ok || err) && (
            <p className="text-xs m-0 mb-2" style={{ color: ok ? "var(--green-on)" : "var(--rose-on)" }}>{ok ?? err}</p>
          )}
          {project.youtubeVideoId ? (
            <div className="text-sm flex flex-col gap-1.5" data-linked-video={project.youtubeVideoId}>
              <a href={watchUrl(project.youtubeVideoId)} target="_blank" rel="noreferrer" className="underline break-all">{linked?.title ?? watchUrl(project.youtubeVideoId)}</a>
              {linked ? (
                <p className="m-0 text-xs text-[var(--mute)]" data-linked-numbers>
                  {linked.views.toLocaleString()} views in the last 90 days
                  {linked.avgViewPct != null ? ` · ${Math.round(linked.avgViewPct)}% average viewed` : ""}
                  {linked.publishedAt ? ` · published ${formatDay(new Date(linked.publishedAt))}` : ""}
                  {" "}— counted on its Topic as this video&apos;s own numbers.
                </p>
              ) : (
                <p className="m-0 text-xs text-[var(--mute)]">
                  {audit.state === "not_connected"
                    ? "YouTube isn't connected, so its numbers can't be shown — connect it under Settings → Analytics."
                    : "Not in the channel's last 90 days of views yet — its numbers appear once YouTube reports them and the audit is read."}
                </p>
              )}
              {editor && (
                <form action={unlinkYoutubeVideoAction}>
                  <input type="hidden" name="id" value={project.id} />
                  <SubmitButton className="btn sm" pendingText="…">Unlink</SubmitButton>
                </form>
              )}
            </div>
          ) : editor ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--mute)] m-0">Once it&apos;s uploaded, link the video so its Topic counts its own views and retention instead of matching titles by keyword.</p>
              <form action={linkYoutubeVideoAction} className="flex gap-1.5">
                <input type="hidden" name="id" value={project.id} />
                <input name="video" required placeholder="Paste the YouTube link or video id" className="flex-1 min-w-0 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" />
                <SubmitButton className="btn sm" pendingText="Linking…">Link</SubmitButton>
              </form>
              {suggestions.length > 0 && (
                <div className="text-xs" data-video-suggestions>
                  <span className="text-[var(--mute)]">Looks like one of these:</span>
                  <ul className="m-0 mt-1 p-0 list-none flex flex-col gap-1">
                    {suggestions.map((v) => (
                      <li key={v.id} className="flex items-center gap-2">
                        <a href={v.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate underline">{v.title}</a>
                        <span className="text-[var(--mute)] font-mono text-micro">{v.views.toLocaleString()} views</span>
                        <form action={linkYoutubeVideoAction}>
                          <input type="hidden" name="id" value={project.id} />
                          <input type="hidden" name="video" value={v.id} />
                          <SubmitButton className="btn sm" pendingText="…">Link this</SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--mute)] m-0">Not linked to its YouTube upload yet.</p>
          )}
        </section>

        {/* E-VID-03: upload this project's video to the connected channel — admins, Private by default, asked first */}
        {admin && (
          <section className="card scroll-mt-20" id="youtube-upload" data-youtube-upload>
            <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2">
              <SquarePlay className="w-4 h-4" style={{ color: "var(--rose)" }} /> Upload to YouTube
            </h2>
            {uploads.map((u) => (
              <div key={u.id} className="text-xs mb-2 p-2 rounded-lg" style={{ background: "var(--zebra)" }} data-upload-state={u.state}>
                <b>{u.title}</b> · <span className="font-mono">{u.state === "draft" ? "waiting for your yes" : u.state}</span>
                {u.state === "uploading" && u.size ? <> · {Math.floor((Number(u.sent) / Number(u.size)) * 100)}% ({formatBytes(Number(u.sent))} of {formatBytes(Number(u.size))})</> : null}
                {u.videoId && <> · <a href={watchUrl(u.videoId)} target="_blank" rel="noreferrer" className="underline">open on YouTube</a> · <a href={`https://studio.youtube.com/video/${u.videoId}/edit`} target="_blank" rel="noreferrer" className="underline">Studio</a></>}
                {u.thumbnailNote && <span className="block text-[var(--mute)]">{u.thumbnailNote}</span>}
                {u.error && <span className="block" style={{ color: "var(--rose-on)" }}>{u.error}</span>}
                {u.state === "draft" && (
                  <div className="mt-1.5" data-upload-confirm>
                    <p className="m-0 mb-1.5">
                      Upload <b>{u.sourceName}</b> to <b>{ytChannel || "the connected channel"}</b> as{" "}
                      <b>{u.publishAt ? `private until ${formatZonedMoment(u.publishAt, tz)}, then public` : u.privacy}</b>
                      {u.madeForKids ? ", made for kids" : ""}{u.thumbnailKey ? ", with a custom thumbnail" : ""}?
                    </p>
                    <div className="flex gap-2">
                      <form action={confirmYoutubeUploadAction}><input type="hidden" name="id" value={u.id} /><SubmitButton className="btn primary sm" pendingText="Starting…">Upload</SubmitButton></form>
                      <form action={youtubeUploadStepAction}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="discard" /><SubmitButton className="btn sm" pendingText="…">Not now</SubmitButton></form>
                    </div>
                  </div>
                )}
                {u.state === "failed" && (
                  <form action={youtubeUploadStepAction} className="mt-1.5 flex gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <SubmitButton className="btn sm" name="op" value="retry" pendingText="…">Retry</SubmitButton>
                    <SubmitButton className="btn sm" name="op" value="discard" pendingText="…">Remove</SubmitButton>
                  </form>
                )}
              </div>
            ))}
            {uploads.some((u) => u.state === "queued" || u.state === "uploading") && <AutoRefresh />}
            {!ytConnected ? (
              <p className="text-xs text-[var(--mute)] m-0">No YouTube channel is connected for uploads — connect it under <Link href="/setup/connections" className="underline">Settings → Connections</Link> (Google asks for upload permission there).</p>
            ) : uploadSources.videos.length === 0 ? (
              <p className="text-xs text-[var(--mute)] m-0">This project has no video file to send yet — a take recorded at the teleprompter, a video Asset linked to it, or a finished storyboard cut of its script.</p>
            ) : (
              <form action={startYoutubeUploadAction} className="flex flex-col gap-2 text-xs">
                <input type="hidden" name="projectId" value={project.id} />
                <label className="flex flex-col gap-1">Video
                  <select name="source" required className="border border-[var(--line-2)] rounded-lg px-2 py-1">
                    {uploadSources.videos.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">Title <span className="text-[var(--mute)]">(up to 100 characters)</span>
                  <input name="title" required maxLength={100} defaultValue={uploadDefaults.title} className="border border-[var(--line-2)] rounded-lg px-2 py-1" />
                </label>
                <label className="flex flex-col gap-1">Description
                  <textarea name="description" rows={6} maxLength={5000} defaultValue={uploadDefaults.description} className="border border-[var(--line-2)] rounded-lg px-2 py-1 font-code text-2xs" />
                  {uploadDefaults.chaptersNote && <span className="text-[var(--mute)]">{uploadDefaults.chaptersNote}</span>}
                </label>
                <label className="flex flex-col gap-1">Tags <span className="text-[var(--mute)]">(comma-separated)</span>
                  <input name="tags" defaultValue={uploadDefaults.tags} className="border border-[var(--line-2)] rounded-lg px-2 py-1" />
                </label>
                <div className="flex flex-wrap gap-3 items-end">
                  <label className="flex flex-col gap-1">Who can see it
                    <select name="privacy" defaultValue="private" className="border border-[var(--line-2)] rounded-lg px-2 py-1">
                      <option value="private">Private</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">Publish at <span className="text-[var(--mute)]">({tz}, optional — stays private until then)</span>
                    <input type="datetime-local" name="publishAt" className="border border-[var(--line-2)] rounded-lg px-2 py-1" />
                  </label>
                  {uploadSources.images.length > 0 && (
                    <label className="flex flex-col gap-1">Thumbnail
                      <select name="thumbnail" defaultValue="" className="border border-[var(--line-2)] rounded-lg px-2 py-1">
                        <option value="">YouTube picks one</option>
                        {uploadSources.images.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <fieldset className="flex gap-3 items-center border-0 p-0 m-0">
                  <legend className="mb-1">Made for kids? <span className="text-[var(--mute)]">YouTube requires an answer</span></legend>
                  <label className="inline-flex items-center gap-1"><input type="radio" name="madeForKids" value="no" required /> No</label>
                  <label className="inline-flex items-center gap-1"><input type="radio" name="madeForKids" value="yes" /> Yes</label>
                </fieldset>
                <p className="text-2xs text-[var(--mute)] m-0">
                  ⚠ YouTube keeps every upload from a Google Cloud project it hasn&apos;t audited <b>private</b>, whatever is chosen here, until the project passes YouTube&apos;s API audit. Captions aren&apos;t sent (that needs a wider YouTube permission) — add the SRT in Studio.
                </p>
                <div><SubmitButton className="btn sm" pendingText="Checking…">Review the upload…</SubmitButton></div>
              </form>
            )}
          </section>
        )}

        {/* E-VID-05: a thumbnail A/B on the published video, scored by YouTube's reach reports — admins */}
        {admin && project.youtubeVideoId && (
          <section className="card scroll-mt-20" id="thumbnail-test" data-thumbnail-test>
            <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2">
              <SquarePlay className="w-4 h-4" style={{ color: "var(--amber-on)" }} /> Thumbnail test
            </h2>
            {thumbTests.map((t) => {
              const variants = readJsonOr<Variant[]>(t.variants, []);
              const windows = readJsonOr<TestWindow[]>(t.windows, []);
              const verdict = readJsonOr<Verdict | null>(t.result, null);
              return (
                <div key={t.id} className="text-xs mb-2 p-2 rounded-lg" style={{ background: "var(--zebra)" }} data-test-state={t.state}>
                  <p className="m-0 mb-1"><b>{t.state === "draft" ? "Waiting for your yes" : t.state === "running" ? `Running — showing ${variants[t.current]?.label ?? "?"}` : t.state === "measuring" ? "Waiting for YouTube's numbers" : t.state}</b> · {t.daysEach} days each</p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
                    {variants.map((v, i) => {
                      const w = windows.find((x) => x.variant === i);
                      const r = verdict?.results.find((x) => x.variant === i);
                      return (
                        <li key={i} className="flex flex-wrap gap-x-2" data-variant={i}>
                          <span className="font-semibold">{v.label}</span>
                          <span className="text-[var(--mute)]">{w ? `${formatZonedMoment(new Date(w.from), tz)}${w.to ? ` – ${formatZonedMoment(new Date(w.to), tz)}` : " – now"}${w.setOk ? "" : " (not set)"}` : "not yet shown"}</span>
                          {r && r.impressions > 0 && <span className="font-mono">{r.impressions.toLocaleString("en-GB")} impressions · {r.ctr != null ? `${(r.ctr * 100).toFixed(1)}%` : "—"} click-through · {r.days} day{r.days === 1 ? "" : "s"}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {verdict && t.state !== "draft" && <p className="m-0 mt-1" data-test-verdict>{verdict.sentence}</p>}
                  {t.error && <p className="m-0 mt-1" style={{ color: "var(--rose-on)" }}>{t.error}</p>}
                  <div className="flex gap-2 mt-1.5">
                    {t.state === "draft" && <form action={confirmThumbnailTestAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn primary sm" pendingText="Setting A…">Start — put {variants[0]?.label.split(" — ")[0]} on the video</SubmitButton></form>}
                    {(t.state === "running" || t.state === "measuring") && <form action={thumbnailTestStepAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn sm" name="op" value="check" pendingText="Checking…">Check now</SubmitButton></form>}
                    {(t.state === "running" || t.state === "measuring") && <form action={thumbnailTestStepAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn sm" name="op" value="stop" pendingText="…">Stop</SubmitButton></form>}
                    {(t.state === "draft" || t.state === "failed" || t.state === "stopped" || t.state === "done") && <form action={thumbnailTestStepAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="btn sm" name="op" value="discard" pendingText="…">{t.state === "draft" ? "Not now" : "Remove"}</SubmitButton></form>}
                  </div>
                </div>
              );
            })}
            {!thumbTests.some((t) => t.state === "running" || t.state === "measuring" || t.state === "draft") && (uploadSources.images.length < 2 ? (
              <p className="text-xs text-[var(--mute)] m-0">Link two or three thumbnail images to this project (Thumbnail Studio renders of its script, or image Assets) to compare them on the video.</p>
            ) : (
              <form action={startThumbnailTestAction} className="flex flex-col gap-2 text-xs">
                <input type="hidden" name="projectId" value={project.id} />
                <fieldset className="border-0 p-0 m-0 flex flex-col gap-1">
                  <legend className="mb-1">Compare (two or three, in the order they run):</legend>
                  {uploadSources.images.map((s) => (
                    <label key={s.value} className="inline-flex items-center gap-1.5"><input type="checkbox" name="variant" value={s.value} /> {s.label}</label>
                  ))}
                </fieldset>
                <label className="inline-flex items-center gap-1.5">Each runs
                  <select name="daysEach" defaultValue="7" className="border border-[var(--line-2)] rounded-lg px-2 py-1">
                    {[3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
                <p className="text-2xs text-[var(--mute)] m-0">
                  Each thumbnail is the video&apos;s thumbnail for its days in turn, then each is scored by the impressions and click-through YouTube reports for it. A winner is named only when the difference is clear on at least 1,000 impressions each; it&apos;s put back on the video. Titles can&apos;t be tested — that needs a wider YouTube permission than the channel granted.
                </p>
                <div><SubmitButton className="btn sm" pendingText="…">Review the test…</SubmitButton></div>
              </form>
            ))}
          </section>
        )}

        {/* Merit + Keywords */}
        <section className="card">
          <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Tag className="w-4 h-4" style={{ color: "var(--violet)" }} /> Strategy tags</h2>

          {editor && (
          <form action={setProjectMeritAction} className="flex items-end gap-2 mb-3">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Idea merit</span>
              <select key={`merit:${project.ideaMerit ?? ""}`} name="merit" defaultValue={project.ideaMerit ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                <option value="">—</option>
                <option value="pillar">Content pillar</option>
                <option value="trending">Trending topic</option>
                <option value="experiment">Experiment</option>
              </select>
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
          )}
          {project.ideaMerit && (
            <span className="font-mono text-2xs font-bold px-2 py-1 rounded-md inline-block mb-3" style={{ background: MERIT_COLOR[project.ideaMerit]?.soft, color: MERIT_COLOR[project.ideaMerit]?.color }}>
              {project.ideaMerit}
            </span>
          )}

          {!editor ? (
            <p className="text-sm m-0"><span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1"><Hash className="w-3 h-3" /> Target keywords</span>{keywords.length ? keywords.join(", ") : "—"}</p>
          ) : (
          <form action={setProjectKeywordsAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1"><Hash className="w-3 h-3" /> Target keywords (comma-separated)</span>
              <textarea name="keywords" defaultValue={keywords.join(", ")} rows={2} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
            </label>
            <button type="submit" className="btn sm self-end">Save</button>
          </form>
          )}
        </section>

        {/* Task progress rollup */}
        {project.tasks.length > 0 && (
          <section className="card">
            <h2 className="font-mono font-bold text-sm mb-3">Tasks ({tasksDone}/{project.tasks.length} done)</h2>
            <div className="h-2 rounded-full bg-[var(--line)] overflow-hidden mb-3">
              <div className="h-full rounded-full transition-all" style={{ width: tasksProgress + "%", background: tasksProgress === 100 ? "var(--green)" : "var(--accent)" }} />
            </div>
            <ul className="m-0 p-0">
              {project.tasks.slice(0, 6).map((t) => (
                <li key={t.id} className="border-t border-[var(--line)] first:border-t-0 py-1.5 text-xs flex items-center gap-2">
                  <span className={"w-2 h-2 rounded-full"} style={{ background: t.status === "done" ? "var(--green)" : t.status === "in_progress" ? "var(--amber)" : "var(--mute)" }} />
                  <span className={"flex-1 " + (t.status === "done" ? "line-through text-[var(--mute)]" : "")}>{t.title}</span>
                  {t.dueDate && <span className="text-micro text-[var(--mute)]">{formatDay(new Date(t.dueDate))}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Attach an SOP checklist as project tasks */}
        {wikiDocs.length > 0 && (
          <section className="card">
            <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4" style={{ color: "var(--indigo)" }} /> Attach SOP checklist</h2>
            <form action={attachChecklistAction} className="flex items-end gap-2">
              <input type="hidden" name="contentProjectId" value={project.id} />
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Wiki page</span>
                <select name="wikiDocId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                  {wikiDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </label>
              <SubmitButton className="btn primary sm">Attach as tasks</SubmitButton>
            </form>
            <p className="text-2xs text-[var(--mute)] mt-2">Converts the wiki page&apos;s checklist (or `- ` bullets in the body) into assigned tasks on this project.</p>
          </section>
        )}

        {/* Repurposing */}
        <section className="card">
          <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><GitBranch className="w-4 h-4" style={{ color: "var(--teal)" }} /> Repurpose</h2>
          {editor ? (
          <form action={repurposeProjectAction} className="flex flex-wrap items-end gap-2 mb-3">
            <input type="hidden" name="parentId" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">New title (optional)</span>
              <input name="title" placeholder={`${project.title} (short)`} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Format</span>
              <select name="format" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                <option value="short">Short</option>
                <option value="long">Long</option>
                <option value="podcast">Podcast cut</option>
                <option value="blog">Blog</option>
              </select>
            </label>
            <SubmitButton className="btn primary sm">Create derivative</SubmitButton>
          </form>
          ) : project.derivatives.length === 0 ? <p className="text-xs text-[var(--mute)] m-0">No derivatives yet.</p> : null}
          {project.derivatives.length > 0 && (
            <ul className="m-0 p-0">
              {project.derivatives.map((d) => (
                <li key={d.id} className="border-t border-[var(--line)] py-2 text-sm flex items-center gap-2">
                  <span className="font-mono text-micro uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{d.format ?? "—"}</span>
                  <Link href={`/production/projects/${d.id}`} className="flex-1 hover:text-[var(--accent)] truncate">{d.title}</Link>
                  <span className="text-micro font-mono text-[var(--mute)]">{d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

