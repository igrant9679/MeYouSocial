import Link from "next/link";
import { Recycle } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatInZone, getPostingTimeZone } from "@/lib/social/slots";
import { evergreenState, parseVariants, type EvergreenState } from "@/lib/social/evergreen-rules";
import { compact, resultsForPosts } from "@/lib/social/post-results";
import { saveEvergreenSettingsAction, setEvergreenAction } from "@/app/actions/social";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/SocialPostCard";
import { EmptyState } from "@/components/EmptyState";

// Distribute → Evergreen (E-SOC-15): every post set to recycle, where each one
// stands (the recycler's own rule — lib/social/evergreen-rules.ts), what it and
// its copies have earned, and its controls: how often, until when, how many
// times, and the texts its copies take turns with.

export default async function EvergreenLibrary({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const sp = await searchParams;
  const [tz, fill, sources] = await Promise.all([
    getPostingTimeZone(workspace.id),
    getSetting("social:evergreen_fill", workspace.id).catch(() => "").then((v) => v === "true"),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, evergreen: true, recycledFromId: null },
      orderBy: [{ lastRecycledAt: { sort: "asc", nulls: "first" } }, { publishedAt: "asc" }],
      select: {
        id: true, text: true, status: true, evergreen: true, recycleEveryDays: true, recycleUntil: true, maxRecycles: true,
        timesRecycled: true, lastRecycledAt: true, publishedAt: true, createdAt: true, recycleVariants: true, category: true,
      },
    }),
  ]);
  const ids = sources.map((s) => s.id);
  const copies = ids.length
    ? await db.socialPost.findMany({ where: { workspaceId: workspace.id, recycledFromId: { in: ids } }, select: { id: true, recycledFromId: true, status: true } })
    : [];
  const inFlight = new Set(copies.filter((c) => ["draft", "scheduled", "publishing"].includes(c.status)).map((c) => c.recycledFromId!));
  // Results across the source and every copy that went out.
  const results = await resultsForPosts([...ids, ...copies.map((c) => c.id)]);
  const earned = (id: string) => {
    const rs = [id, ...copies.filter((c) => c.recycledFromId === id).map((c) => c.id)].map((x) => results.get(x)).filter((r) => r != null);
    const sum = (pick: (r: (typeof rs)[number]) => number | null) => {
      const v = rs.map(pick).filter((n): n is number => n != null);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    return rs.length ? { impressions: sum((r) => r.impressions), engagement: sum((r) => r.engagement), sends: rs.length } : null;
  };
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <h1 className="font-mono text-2xl font-bold m-0 flex items-center gap-2"><Recycle className="w-5 h-5" style={{ color: "var(--green-on)" }} /> Evergreen</h1>
        <p className="text-sm text-[var(--mute)] m-0">
          {sources.length ? `${sources.length} post${sources.length === 1 ? "" : "s"} set to recycle into free queue slots.` : "No post is set to recycle."}
        </p>
      </div>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}
      <p className="card text-xs mb-3" style={fill ? undefined : { background: "var(--amber-soft)", color: "var(--amber-on)" }} data-evergreen-fill={fill ? "on" : "off"}>
        {fill
          ? "Evergreen fill is on: when a post's cooldown is over, a copy goes into a free slot in the next week — at most five a sweep, one copy in flight per post."
          : <>Evergreen fill is off, so nothing here recycles yet. <Link href="/setup/automation" className="underline">Turn it on in Settings → Automation</Link>.</>}
      </p>

      {sources.length === 0 ? (
        <EmptyState
          variant="inline"
          line="Nothing is evergreen yet."
          note="Tick Evergreen when composing a post, or press the recycle button on a post in Sent."
          action={{ label: "Open Sent", href: "/social/sent" }}
        />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {sources.map((s) => {
            const state = evergreenState(s, inFlight.has(s.id));
            const variants = parseVariants(s.recycleVariants);
            const e = earned(s.id);
            return (
              <li key={s.id} className="card !py-3 text-xs" data-evergreen-source={s.id} data-evergreen-state={state.kind}>
                <div className="flex flex-wrap items-start gap-3">
                  <p className="m-0 flex-1 min-w-60 whitespace-pre-wrap line-clamp-3 text-sm">{s.text || <span className="text-[var(--mute)]">(no text)</span>}</p>
                  <StateChip state={state} tz={tz} />
                </div>
                <p className="m-0 mt-1.5 text-[var(--mute)] font-mono text-2xs">
                  every {s.recycleEveryDays}d · recycled {s.timesRecycled}{s.maxRecycles != null ? ` of ${s.maxRecycles}` : ""}×
                  {s.recycleUntil ? ` · until ${formatInZone(s.recycleUntil, tz)}` : ""}
                  {s.lastRecycledAt ? ` · last copy ${formatInZone(s.lastRecycledAt, tz)}` : ""}
                  {variants.length ? ` · ${variants.length} variant${variants.length === 1 ? "" : "s"}` : ""}
                  {s.category ? ` · ${s.category}` : ""}
                </p>
                <p className="m-0 mt-1 font-mono text-2xs" data-evergreen-earned>
                  {e ? <>Across {e.sends} send{e.sends === 1 ? "" : "s"}: <b>{compact(e.impressions)}</b> impr · <b>{compact(e.engagement)}</b> eng</> : <span className="text-[var(--mute)]">No results measured yet.</span>}
                </p>
                {editor && (
                  <div className="flex flex-wrap items-start gap-2 mt-2">
                    <details className="flex-1 min-w-60" data-evergreen-settings>
                      <summary className="btn sm cursor-pointer list-none w-fit">Settings…</summary>
                      <form action={saveEvergreenSettingsAction} className="mt-2 flex flex-col gap-2 max-w-xl">
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="back" value="/social/evergreen" />
                        <div className="flex flex-wrap gap-3">
                          <label>Every <input type="number" name="recycleEveryDays" min={1} max={365} defaultValue={s.recycleEveryDays} className="w-16 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /> days</label>
                          <label>Until <input type="date" name="recycleUntil" defaultValue={s.recycleUntil ? day(s.recycleUntil) : ""} className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /></label>
                          <label>At most <input type="number" name="maxRecycles" min={1} max={1000} defaultValue={s.maxRecycles ?? ""} placeholder="∞" className="w-16 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /> times</label>
                        </div>
                        <label className="flex flex-col gap-1">
                          <span>Variants — other wordings the copies take turns with, the original included. One per block; separate blocks with a line holding only <code>---</code>.</span>
                          <textarea name="variants" rows={4} defaultValue={variants.join("\n---\n")} className="w-full border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs font-mono" />
                        </label>
                        <SubmitButton className="btn sm primary w-fit" pendingText="Saving…">Save</SubmitButton>
                      </form>
                    </details>
                    <form action={setEvergreenAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="on" value="0" />
                      <input type="hidden" name="back" value="/social/evergreen" />
                      <SubmitButton className="btn sm" pendingText="…">Stop recycling</SubmitButton>
                    </form>
                    <Link href={`/social/${s.id}`} className="btn sm">Open</Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StateChip({ state, tz }: { state: EvergreenState; tz: string }) {
  const [label, hue] =
    state.kind === "due" ? ["Due — next free slot", "green"]
    : state.kind === "cooling" ? [`Next out after ${formatInZone(state.until, tz)}`, "blue"]
    : state.kind === "in_flight" ? ["A copy is queued", "violet"]
    : state.kind === "finished" ? [`Done — recycled ${state.max}×`, "slate"]
    : state.kind === "ended" ? [`Ended ${formatInZone(state.until, tz)}`, "slate"]
    : state.kind === "not_sent" ? ["Recycles once it has gone out", "amber"]
    : ["Off", "slate"];
  return (
    <span className="font-mono text-micro px-2 py-0.5 rounded-full shrink-0" style={{ background: `var(--${hue}-soft, var(--zebra))`, color: `var(--${hue}-on, var(--mute))` }} data-state-chip>
      {label}
    </span>
  );
}
