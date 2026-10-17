import Link from "next/link";
import { CalendarDays, Copy, ImageIcon, Megaphone, Sparkles, Timer } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { getPostingTimeZone } from "@/lib/social/slots";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/EmptyState";
import { Banner } from "@/components/SocialPostCard";
import { SCENARIOS, type Scenario } from "@/lib/caption-studio/prompts";
import { COUNTDOWN_STAGES, todayIn, shiftDay } from "@/lib/caption-studio/timing";
import { dayLabel, monthRange, shiftMonth } from "@/lib/caption-studio/special-days";
import {
  addSpecialDayAction,
  generateBatchAction,
  pasteSpecialDaysAction,
  rollForwardAction,
  updateSpecialDayAction,
} from "@/app/actions/caption-studio";

// Caption Studio — the team's "Caption Prompts & Scenarios" doc, run by the
// app (Socialmonials parity, phase 3, 2026-10-17). Four scenarios; each
// generates a BATCH a person reviews before anything reaches the queue.

type SP = { s?: string; month?: string; ok?: string; err?: string };
const ICONS: Record<Scenario, React.ReactNode> = {
  special_days: <CalendarDays className="w-4 h-4" />,
  campaign: <Megaphone className="w-4 h-4" />,
  images: <ImageIcon className="w-4 h-4" />,
  countdown: <Timer className="w-4 h-4" />,
};
const inputCls = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

export default async function CaptionStudioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const sp = await searchParams;
  const scenario = (Object.keys(SCENARIOS).includes(sp.s ?? "") ? sp.s : "special_days") as Scenario;
  const tz = await getPostingTimeZone(workspace.id);
  const today = todayIn(tz);
  // Default to NEXT month — the doc gathers next month's days ahead of time.
  const month = monthRange(sp.month ?? "") ? sp.month! : shiftMonth(today.slice(0, 7), 1);
  const range = monthRange(month)!;

  const [days, campaigns, batches] = await Promise.all([
    db.specialDay.findMany({ where: { workspaceId: workspace.id, day: { gte: range.from, lte: range.to } }, orderBy: [{ day: "asc" }, { name: "asc" }] }),
    db.campaign.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { posts: true } } } }),
    db.captionBatch.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, scenario: true, status: true, createdAt: true, items: true } }),
  ]);
  const selectedCount = days.filter((d) => d.selected).length;
  const unverified = days.filter((d) => !d.verified).length;

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="font-mono text-[22px] font-bold m-0">Caption Studio</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">Captions written to the house rules — a header, the caption, exactly two hashtags — for {workspace.name}. Everything lands in a batch you review before it reaches the queue.</p>
      </div>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}

      <div className="flex flex-wrap gap-1.5 my-3" role="tablist">
        {(Object.keys(SCENARIOS) as Scenario[]).map((k) => (
          <Link key={k} href={`/social/captions?s=${k}${k === "special_days" ? `&month=${month}` : ""}`} role="tab" aria-selected={k === scenario}
            className={`btn sm ${k === scenario ? "primary" : ""}`}>
            {ICONS[k]} {SCENARIOS[k].label}
          </Link>
        ))}
      </div>
      <p className="text-xs text-[var(--mute)] mb-3">{SCENARIOS[scenario].blurb}</p>

      {!editor && <EmptyState line="Writing captions needs an editor." note="You can see the batches below; an editor or admin generates and saves them." />}

      {/* ── Special days ─────────────────────────────────────────────── */}
      {editor && scenario === "special_days" && (
        <>
          <div className="card mb-3">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Link href={`/social/captions?s=special_days&month=${shiftMonth(month, -1)}`} className="btn sm">←</Link>
              <h2 className="font-mono text-[14px] font-bold m-0">{range.label}</h2>
              <Link href={`/social/captions?s=special_days&month=${shiftMonth(month, 1)}`} className="btn sm">→</Link>
              <span className="text-[11px] text-[var(--mute)]">{days.length} day{days.length === 1 ? "" : "s"} · {selectedCount} picked{unverified ? ` · ${unverified} date${unverified === 1 ? "" : "s"} to check` : ""}</span>
              <span className="flex-1" />
              <form action={rollForwardAction}>
                <input type="hidden" name="month" value={month} />
                <SubmitButton className="btn sm" pendingText="Copying…" title="Copy last year's days for this month, marked “check the date”"><Copy className="w-3 h-3" /> Copy from {range.year - 1}</SubmitButton>
              </form>
            </div>
            {days.length === 0 ? (
              <EmptyState variant="inline" line={`Nothing on ${range.label}'s list yet.`} note="Add the days below, paste a list, or copy last year's — the doc's “use the previous year's list as a reference”." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[var(--mute)]">
                      <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Picked</th>
                      <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Day</th>
                      <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Special day</th>
                      <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Date checked</th>
                      <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Client&apos;s note for this day</th>
                      <th className="py-1.5 px-2 border-b-2 border-[var(--line)]" />
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const fid = `sd-${d.id}`;
                      return (
                        <tr key={d.id} className="border-b border-[var(--line)] last:border-0 align-middle" style={d.selected ? { background: "var(--green-soft)" } : undefined}>
                          {/* One form per row; inputs join it via form=, so the table stays valid HTML. */}
                          <td className="py-1.5 px-2"><input type="checkbox" name="selected" form={fid} defaultChecked={d.selected} aria-label={`Pick ${d.name}`} /></td>
                          <td className="py-1.5 px-2 whitespace-nowrap"><input type="date" name="day" form={fid} defaultValue={d.day} className={inputCls} /></td>
                          <td className="py-1.5 px-2">
                            <span className="font-semibold">{d.name}</span>
                            <span className="text-[10px] text-[var(--mute)] ml-1">{dayLabel(d.day)}{d.selected && d.selectedBy ? ` · picked by ${d.selectedBy}` : ""}</span>
                          </td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" name="verified" form={fid} defaultChecked={d.verified} />
                              {d.verified ? "checked" : <span style={{ color: "var(--amber-on)" }}>check the date</span>}
                            </label>
                          </td>
                          <td className="py-1.5 px-2 min-w-56"><input name="note" form={fid} defaultValue={d.note ?? ""} maxLength={500} placeholder="e.g. mention our open house" className={`${inputCls} w-full`} /></td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <form id={fid} action={updateSpecialDayAction} className="inline">
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="month" value={month} />
                              <SubmitButton className="btn sm" pendingText="…">Save</SubmitButton>
                            </form>
                            <span className="inline-block ml-1"><DeleteButton kind="specialDay" id={d.id} name={d.name} returnTo={`/social/captions?s=special_days&month=${month}`} iconOnly /></span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 mb-3">
            <form action={addSpecialDayAction} className="card flex flex-wrap items-end gap-2">
              <input type="hidden" name="month" value={month} />
              <label className="text-xs flex-1 min-w-40"><span className="block text-[10px] text-[var(--mute)] mb-1">Special day</span><input name="name" required maxLength={120} placeholder="Women's Entrepreneurship Day" className={`${inputCls} w-full`} /></label>
              <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Date</span><input type="date" name="day" required defaultValue={range.from} className={inputCls} /></label>
              <label className="text-xs flex-1 min-w-40"><span className="block text-[10px] text-[var(--mute)] mb-1">Note (optional)</span><input name="note" maxLength={500} className={`${inputCls} w-full`} /></label>
              <SubmitButton className="btn sm" pendingText="Adding…">Add</SubmitButton>
            </form>
            <form action={pasteSpecialDaysAction} className="card flex flex-col gap-2">
              <input type="hidden" name="month" value={month} />
              <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Paste a list — one per line, with its date (“Nov 19 — Women&apos;s Entrepreneurship Day”, “11/26 Thanksgiving | thank our donors”)</span>
                <textarea name="text" rows={4} className={`${inputCls} w-full`} placeholder={"Nov 3 — Election Day\nNov 13 — World Kindness Day\nNov 26 — Thanksgiving | thank our volunteers"} /></label>
              <div><SubmitButton className="btn sm" pendingText="Adding…">Add these</SubmitButton> <span className="text-[10px] text-[var(--mute)]">Lines without a date are reported back, never guessed. The year is {range.year} unless a line says otherwise.</span></div>
            </form>
          </div>

          <form action={generateBatchAction} className="card flex flex-wrap items-end gap-2 mb-6">
            <input type="hidden" name="scenario" value="special_days" />
            <input type="hidden" name="month" value={month} />
            <label className="text-xs flex-1 min-w-64"><span className="block text-[10px] text-[var(--mute)] mb-1">Recommendations for the whole month (optional)</span><input name="notes" maxLength={2000} className={`${inputCls} w-full`} placeholder="e.g. keep a warm, community tone; mention the new office" /></label>
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Post at ({tz})</span><input type="time" name="postAt" defaultValue="08:00" className={inputCls} /></label>
            <SubmitButton className="btn primary" pendingText="Writing captions…" disabled={selectedCount === 0}><Sparkles className="w-4 h-4" /> Write captions for {selectedCount} picked day{selectedCount === 1 ? "" : "s"}</SubmitButton>
          </form>
        </>
      )}

      {/* ── Weekly campaign ──────────────────────────────────────────── */}
      {editor && scenario === "campaign" && (
        <form action={generateBatchAction} className="card flex flex-col gap-3 mb-6">
          <input type="hidden" name="scenario" value="campaign" />
          <CampaignPicker campaigns={campaigns} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">How many new posts</span><input type="number" name="count" min={1} max={12} defaultValue={4} className={`${inputCls} w-20`} /></label>
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Post at, when scheduled ({tz})</span><input type="time" name="postAt" defaultValue="08:00" className={inputCls} /></label>
          </div>
          <PreviousCaptions />
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Notes (optional)</span><input name="notes" maxLength={2000} className={`${inputCls} w-full`} /></label>
          <div><SubmitButton className="btn primary" pendingText="Writing captions…"><Sparkles className="w-4 h-4" /> Write the new posts</SubmitButton></div>
        </form>
      )}

      {/* ── From image descriptions ──────────────────────────────────── */}
      {editor && scenario === "images" && (
        <form action={generateBatchAction} encType="multipart/form-data" className="card flex flex-col gap-3 mb-6">
          <input type="hidden" name="scenario" value="images" />
          <CampaignPicker campaigns={campaigns} />
          <p className="text-[11px] text-[var(--mute)] m-0">One caption per picture, written from its description — the doc&apos;s Adult Continuing Education flow. The picture is attached to its post.</p>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 border-t border-[var(--line)] pt-2">
              <span className="font-mono text-[10px] text-[var(--mute)] w-14 pt-1.5">Image {i + 1}</span>
              <input type="file" name={`img_${i}`} accept="image/png,image/jpeg,image/gif,image/webp" className="text-xs" />
              <textarea name={`desc_${i}`} rows={2} maxLength={600} placeholder="The description that came with the picture" className={`${inputCls} flex-1 min-w-64`} />
            </div>
          ))}
          <PreviousCaptions />
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Post at, when scheduled ({tz})</span><input type="time" name="postAt" defaultValue="08:00" className={inputCls} /></label>
            <label className="text-xs flex-1 min-w-64"><span className="block text-[10px] text-[var(--mute)] mb-1">Notes (optional)</span><input name="notes" maxLength={2000} className={`${inputCls} w-full`} /></label>
          </div>
          <div><SubmitButton className="btn primary" pendingText="Writing captions…"><Sparkles className="w-4 h-4" /> Write a caption per image</SubmitButton></div>
        </form>
      )}

      {/* ── Event countdown ──────────────────────────────────────────── */}
      {editor && scenario === "countdown" && (
        <form action={generateBatchAction} className="card flex flex-col gap-3 mb-6">
          <input type="hidden" name="scenario" value="countdown" />
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs flex-1 min-w-56"><span className="block text-[10px] text-[var(--mute)] mb-1">Event name</span><input name="eventName" required maxLength={120} className={`${inputCls} w-full`} placeholder="Spring Open House" /></label>
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Event date</span><input type="date" name="eventDay" required defaultValue={shiftDay(today, 21)} className={inputCls} /></label>
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Posts go out at ({tz})</span><input type="time" name="postAt" defaultValue="08:00" className={inputCls} /></label>
          </div>
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Event details — time, place, who it&apos;s for, how to register (paste the event information)</span>
            <textarea name="event" required rows={4} maxLength={3000} className={`${inputCls} w-full`} /></label>
          <fieldset className="text-xs">
            <legend className="text-[10px] text-[var(--mute)] mb-1">Countdown posts needed</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {COUNTDOWN_STAGES.map((s) => (
                <label key={s.key} className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" name="stages" value={s.key} defaultChecked={s.key !== "announce2" && s.key !== "after"} /> {s.label}
                </label>
              ))}
            </div>
            <p className="text-[10px] text-[var(--mute)] mt-1 mb-0">Each post is dated from the event day; the first announcement goes 4 weeks out (or tomorrow, if the event is sooner). Every date is editable before anything is scheduled, and stages already past are left out.</p>
          </fieldset>
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Notes (optional)</span><input name="notes" maxLength={2000} className={`${inputCls} w-full`} /></label>
          <div><SubmitButton className="btn primary" pendingText="Writing the series…"><Sparkles className="w-4 h-4" /> Write the countdown</SubmitButton></div>
        </form>
      )}

      {/* ── Recent batches ───────────────────────────────────────────── */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Recent batches</h2>
      {batches.length === 0 ? (
        <EmptyState line="No captions written here yet." note="Each run makes a batch: you edit, check the flags, then schedule, queue or save it as drafts." />
      ) : (
        <ul className="card flex flex-col gap-1.5 m-0">
          {batches.map((b) => {
            const its = readJson<Array<{ postId: string | null; include: boolean; flags: unknown[] }>>(b.items, []);
            const made = its.filter((i) => i.postId).length;
            const flagged = its.filter((i) => i.flags?.length).length;
            return (
              <li key={b.id} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-[var(--mute)]">{ICONS[b.scenario as Scenario]}</span>
                <Link href={`/social/captions/${b.id}`} className="font-semibold hover:underline">{b.title}</Link>
                <span className="font-mono text-[10px] text-[var(--mute)]">{its.length} caption{its.length === 1 ? "" : "s"} · {made ? `${made} posted to the queue/drafts` : "in review"}{flagged && !made ? ` · ${flagged} flagged` : ""}</span>
                <span className="flex-1" />
                <span className="text-[10px] text-[var(--mute)]">{b.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CampaignPicker({ campaigns }: { campaigns: Array<{ id: string; name: string; _count: { posts: number } }> }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {campaigns.length > 0 && (
        <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Campaign</span>
          <select name="campaignId" defaultValue="" className={inputCls}>
            <option value="">— a new one, named here →</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c._count.posts} post{c._count.posts === 1 ? "" : "s"})</option>)}
          </select>
        </label>
      )}
      <label className="text-xs flex-1 min-w-56"><span className="block text-[10px] text-[var(--mute)] mb-1">{campaigns.length ? "…or a campaign name" : "Campaign name"}</span><input name="campaignName" maxLength={120} placeholder="Kids Therapy" className={`${inputCls} w-full`} /></label>
      <span className="text-[10px] text-[var(--mute)] basis-full">A campaign&apos;s last 8 posts are read automatically as the &ldquo;previous captions&rdquo; the new ones must not copy.</span>
    </div>
  );
}

function PreviousCaptions() {
  return (
    <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Previous captions to learn the style from (optional — paste them, separated by a line of ---)</span>
      <textarea name="previous" rows={4} maxLength={12000} className={`${inputCls} w-full`} placeholder={"First previous caption…\n---\nSecond previous caption…"} /></label>
  );
}
