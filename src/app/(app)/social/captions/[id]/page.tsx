import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarClock, ListPlus, RotateCw, Save } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { networkFor } from "@/lib/social/networks";
import { listCategories } from "@/lib/social/categories";
import { getPostingTimeZone, formatMinute } from "@/lib/social/slots";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { Banner, MediaThumbs } from "@/components/SocialPostCard";
import { SCENARIOS, type Scenario } from "@/lib/caption-studio/prompts";
import { assemble } from "@/lib/caption-studio/checks";
import { dayLabel } from "@/lib/caption-studio/special-days";
import { regenerateBatchAction, saveBatchAction, type BatchItem } from "@/app/actions/caption-studio";

// Reviewing one Caption Studio batch — the doc's last step ("review the
// generated captions … make sure they aren't repetitive … check hashtags,
// length, emojis and overall tone"), with the app's own checks flagged on
// each caption. Nothing here reaches a network until a Save button says so.

const inputCls = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

export default async function CaptionBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const batch = await db.captionBatch.findFirst({ where: { id, workspaceId: workspace.id }, include: { campaign: { select: { name: true } } } });
  if (!batch) notFound();
  const items = readJson<BatchItem[]>(batch.items, []);
  const [tz, accounts, used] = await Promise.all([
    getPostingTimeZone(workspace.id),
    db.zernioAccount.findMany({ where: { workspaceId: workspace.id, status: "connected" }, orderBy: { createdAt: "asc" }, select: { id: true, platform: true, displayName: true, username: true } }),
    db.socialPost.findMany({ where: { workspaceId: workspace.id, category: { not: null } }, distinct: ["category"], select: { category: true } }),
  ]);
  const categories = await listCategories(workspace.id, used.map((u) => u.category));
  const scenario = batch.scenario as Scenario;
  const dated = scenario === "special_days" || scenario === "countdown";
  const defaultCategory = scenario === "special_days" ? "Holiday/Special Days" : "";
  const open = items.filter((it) => !it.postId);
  const flagged = open.filter((it) => it.flags?.length).length;
  const formId = "batch-form";

  return (
    <div>
      <Link href={`/social/captions?s=${scenario}`} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-2">
        <ArrowLeft className="w-3.5 h-3.5" /> Caption Studio
      </Link>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="font-mono text-[20px] font-bold m-0">{batch.title}</h1>
        <span className="text-[12px] text-[var(--mute)]">{SCENARIOS[scenario]?.label} · {items.length} caption{items.length === 1 ? "" : "s"}{batch.campaign ? ` · campaign ${batch.campaign.name}` : ""}{batch.provider ? ` · written by ${batch.provider}` : ""}</span>
      </div>
      <p className="text-xs text-[var(--mute)] mb-3">
        {open.length === 0
          ? "Every caption in this batch is already a post — edit them on the Queue or Drafts list."
          : `Edit anything, untick what you don't want, then schedule, queue or save as drafts. ${flagged ? `${flagged} caption${flagged === 1 ? " has" : "s have"} a flag worth a look.` : "No flags — nothing broke the house rules the app can check."}`}
      </p>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}

      <form id={formId} action={saveBatchAction} encType="multipart/form-data">
        <input type="hidden" name="id" value={batch.id} />
        <ol className="flex flex-col gap-3 m-0 p-0 list-none">
          {items.map((it, i) => {
            const text = assemble(it);
            return (
              <li key={i} className="card" style={it.postId ? { opacity: 0.7 } : it.flags?.length ? { borderColor: "var(--amber)" } : undefined}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {!it.postId && editor && (
                    <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" name={`inc_${i}`} defaultChecked={it.include} /> Include
                    </label>
                  )}
                  <span className="font-mono text-[11px] font-bold">{it.item.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "")}</span>
                  {it.day && <span className="font-mono text-[10px] text-[var(--mute)]">{dayLabel(it.day)} · {formatMinute(it.minute)} {tz}</span>}
                  {it.past && <span className="text-[10px]" style={{ color: "var(--amber-on)" }}>this date has already passed</span>}
                  <span className="flex-1" />
                  {it.postId
                    ? <Link href={`/social/${it.postId}/edit`} className="text-[11px] underline">Saved as a post — open it</Link>
                    : <span className="font-mono text-[10px] text-[var(--mute)]">{text.length} characters · X version {it.x.length}/280</span>}
                </div>
                {it.flags?.length > 0 && !it.postId && (
                  <ul className="m-0 mb-2 p-2 rounded-lg text-[11px] flex flex-col gap-0.5 list-none" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                    {it.flags.map((f, j) => <li key={j} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {f.text}</li>)}
                  </ul>
                )}
                {it.postId || !editor ? (
                  <p className="text-xs whitespace-pre-wrap m-0">{text}</p>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-[1fr_260px]">
                    <div className="flex flex-col gap-1.5">
                      <input name={`h_${i}`} defaultValue={it.header} maxLength={200} placeholder="Header / tagline" className={`${inputCls} font-semibold`} />
                      <textarea name={`b_${i}`} defaultValue={it.body} rows={4} maxLength={2000} className={inputCls} />
                      <input name={`t_${i}`} defaultValue={it.hashtags.join(" ")} maxLength={200} placeholder="#Two #Hashtags" className={`${inputCls} font-mono`} />
                      <label className="text-[10px] text-[var(--mute)]">X (Twitter) version — sent to X instead of the full caption
                        <textarea name={`x_${i}`} defaultValue={it.x} rows={2} maxLength={400} className={`${inputCls} w-full mt-0.5`} />
                      </label>
                    </div>
                    <div className="flex flex-col gap-2">
                      {dated || scenario === "campaign" || scenario === "images" ? (
                        <div className="flex flex-wrap items-end gap-1.5">
                          <label className="text-[10px] text-[var(--mute)]">Day<input type="date" name={`d_${i}`} defaultValue={it.day ?? ""} className={`${inputCls} block mt-0.5`} /></label>
                          <label className="text-[10px] text-[var(--mute)]">Time<input type="time" name={`tm_${i}`} defaultValue={formatMinute(it.minute)} className={`${inputCls} block mt-0.5`} /></label>
                        </div>
                      ) : null}
                      {it.mediaKey ? (
                        <div className="flex items-start gap-2">
                          <MediaThumbs keys={[it.mediaKey]} size="h-16 w-16" />
                          <label className="text-[10px] inline-flex items-center gap-1"><input type="checkbox" name={`rm_${i}`} /> remove</label>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--mute)]">No image — Instagram and other image-only networks are left off this one{scenario !== "images" ? ", and the workspace's auto-image may add one" : ""}.</span>
                      )}
                      <label className="text-[10px] text-[var(--mute)]">{it.mediaKey ? "Replace the image" : "Attach an image"}
                        <input type="file" name={`m_${i}`} accept="image/png,image/jpeg,image/gif,image/webp" className="block text-[11px] mt-0.5" />
                      </label>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {editor && open.length > 0 && (
          <div className="card mt-4 flex flex-col gap-3 sticky bottom-2" style={{ background: "var(--panel)" }}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Post to</span>
              {accounts.length === 0 && <span className="text-[var(--mute)]">No connected accounts — you can still save these as drafts.</span>}
              {accounts.map((a) => (
                <label key={a.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--line-2)] cursor-pointer">
                  <input type="checkbox" name="accountIds" value={a.id} defaultChecked />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: networkFor(a.platform)?.color ?? "var(--mute)" }} />
                  {networkFor(a.platform)?.label ?? a.platform}
                  <span className="text-[var(--mute)]">{a.displayName ?? a.username}</span>
                </label>
              ))}
              <span className="flex-1" />
              <label className="inline-flex items-center gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Category</span>
                <select name="category" defaultValue={defaultCategory} className={inputCls}>
                  <option value="">— none —</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton className="btn sm" name="mode" value="edits" pendingText="Saving…" title="Keep your edits and re-run the checks; nothing is posted"><Save className="w-3.5 h-3.5" /> Save edits</SubmitButton>
              {dated && <SubmitButton className="btn primary" name="mode" value="schedule" pendingText="Scheduling…" title="Each caption at its own day and time"><CalendarClock className="w-4 h-4" /> Schedule at their times</SubmitButton>}
              {!dated && <SubmitButton className="btn primary" name="mode" value="queue" pendingText="Queueing…" title="Each into the next free posting slot"><ListPlus className="w-4 h-4" /> Add to the queue</SubmitButton>}
              {!dated && <SubmitButton className="btn" name="mode" value="schedule" pendingText="Scheduling…" title="Each at the day and time set on it (captions without a day are skipped)"><CalendarClock className="w-4 h-4" /> Schedule at the days set</SubmitButton>}
              <SubmitButton className="btn" name="mode" value="drafts" pendingText="Saving…" title="Drafts that keep their proposed time — never auto-queued; schedule each when ready">Save as drafts</SubmitButton>
              <span className="flex-1" />
              <span className="text-[10px] text-[var(--mute)] max-w-sm">X gets each caption&apos;s short version. A draft keeps its proposed time, so full autonomy won&apos;t queue it into a random slot.</span>
            </div>
          </div>
        )}
      </form>

      {editor && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <form action={regenerateBatchAction}>
            <input type="hidden" name="id" value={batch.id} />
            <SubmitButton className="btn sm" pendingText="Rewriting…" title="A new batch from the same input — this one is kept"><RotateCw className="w-3.5 h-3.5" /> Write them again</SubmitButton>
          </form>
          {/* Deleting a batch never touches the posts made from it — they are
              separate records with their own delete. */}
          <DeleteButton kind="captionBatch" id={batch.id} name={batch.title} returnTo="/social/captions" label={open.length === items.length ? "Discard this batch" : "Delete this batch (its posts stay)"} />
        </div>
      )}
    </div>
  );
}
