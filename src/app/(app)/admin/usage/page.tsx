import { formatZonedMoment } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";
import Link from "next/link";
import { BarChart3, Users, Sparkles, PenLine, Image as ImageIcon, Bot, FileText, Share2, Gauge } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { formatNum } from "@/lib/intel";
import { youtubeUnitsSince } from "@/lib/youtube";
import { AGENT_RUN_ACTION, THUMBNAIL_ACTIONS, monthStartUtc } from "@/lib/soft-limits";
import { MODELS, PROVIDER_LABEL, modelLabel } from "@/lib/llm/models";
import { BUDGET_KEY, BUDGET_THRESHOLDS, PRICES_KEY, estimateCost, formatUsd, parseBudget, parsePrices, purposeLabel } from "@/lib/ai-spend";
import { getSetting } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { saveModelPricesAction, saveTokenBudgetAction, saveVideoBudgetAction, saveVideoPricesAction } from "@/app/actions/ai-spend";
import { monthSpend, videoPrices, usd, perSecondUsd, VIDEO_SCENE_ACTION } from "@/lib/video-spend";
import { VIDEO_MODEL } from "@/lib/video";

// Usage: what this workspace made this month (UTC), what each AI provider was
// asked for, and the soft limits. The limits cap each PERSON, so they're shown
// against the busiest person, not the workspace's total (audit SET-02).

const PROVIDER_NAME: Record<string, string> = { ...PROVIDER_LABEL, openai: "OpenAI", mock: "Placeholder" };

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user, workspace } = await requireRole("ADMIN");
  const { ok, err } = await searchParams;
  const operator = isPlatformOperator(user.email);
  const ws = workspace.id;
  const postingTz = await getPostingTimeZone(ws);
  const now = new Date();
  const monthStart = monthStartUtc(now);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

  // YouTube Data API units this workspace spent (IDE-13): the daily pool is the
  // key's Cloud project's, which several tenants may share. UTC days — Google's
  // quota resets at midnight Pacific, so this is a guide, not their counter.
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [ytToday, ytMonth] = await Promise.all([youtubeUnitsSince(ws, dayStart), youtubeUnitsSince(ws, monthStart)]);
  const month = { gte: monthStart };
  const [activeUsers, totalChannels, articles, socialPosts, scripts, thumbnails, agentRuns, totalScripts, aiRows, firstAiRow, recentUsageLogs, purposeRows, priceRow, budgetRaw] = await Promise.all([
    db.user.count({ where: { memberships: { some: { workspaceId: ws, status: "active" } }, lastActivityAt: { gte: weekStart } } }),
    db.channel.count({ where: { workspaceId: ws } }),
    db.blogPost.count({ where: { workspaceId: ws, createdAt: month } }),
    db.socialPost.count({ where: { workspaceId: ws, createdAt: month } }),
    db.script.count({ where: { channel: { workspaceId: ws }, createdAt: month } }),
    db.thumbnail.count({ where: { channel: { workspaceId: ws }, createdAt: month } }),
    db.agentRun.count({ where: { script: { channel: { workspaceId: ws } }, startedAt: month } }),
    db.script.count({ where: { channel: { workspaceId: ws } } }),
    // Every AI call is metered by the routers (lib/usage-meter.ts).
    db.usageLog.groupBy({
      by: ["action", "provider", "model"],
      where: { workspaceId: ws, action: { in: ["ai.text", "ai.image"] }, createdAt: month },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.usageLog.findFirst({ where: { workspaceId: ws, action: { in: ["ai.text", "ai.image"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    // The metered rows are summed above, not listed one by one.
    db.usageLog.findMany({ where: { workspaceId: ws, action: { notIn: ["youtube.api", "ai.text", "ai.image"] } }, orderBy: { createdAt: "desc" }, take: 15 }),
    // E-ENG-07: what the tokens went on, per model so each can be priced.
    db.usageLog.groupBy({
      by: ["purpose", "model"],
      where: { workspaceId: ws, action: "ai.text", createdAt: month },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, tokens: true },
    }),
    // The operator's prices are platform-wide: the global row, never a workspace's.
    db.setting.findUnique({ where: { key: PRICES_KEY }, select: { value: true } }),
    getSetting(BUDGET_KEY, ws),
  ]);
  const prices = parsePrices(priceRow?.value);
  // E-VID-06: video by the second — the month's metered scenes, the operator's prices, the workspace's budget.
  const [video, vPrices, videoModelsSeen] = await Promise.all([
    monthSpend(ws),
    videoPrices(),
    db.usageLog.findMany({ where: { action: VIDEO_SCENE_ACTION, model: { not: null } }, distinct: ["model"], select: { model: true }, take: 20 }),
  ]);
  const videoModels = [...new Set([VIDEO_MODEL, ...videoModelsSeen.map((m) => m.model!), ...Object.keys(vPrices)])];
  const videoPct = video.budget ? (video.seconds / video.budget) * 100 : 0;
  const budget = parseBudget(budgetRaw);
  const usedTokens = purposeRows.reduce((n, r) => n + (r._sum.tokens ?? 0), 0);
  const budgetPct = budget ? (usedTokens / budget) * 100 : 0;
  // By purpose: summed over models; the cost only from models with a price.
  type PurposeLine = { purpose: string | null; calls: number; inTok: number; outTok: number; cost: number | null; unpriced: number };
  const byPurpose = new Map<string, PurposeLine>();
  for (const r of purposeRows) {
    const k = r.purpose ?? "";
    const line = byPurpose.get(k) ?? { purpose: r.purpose, calls: 0, inTok: 0, outTok: 0, cost: null, unpriced: 0 };
    line.calls += r._count._all;
    line.inTok += r._sum.inputTokens ?? 0;
    line.outTok += r._sum.outputTokens ?? 0;
    const c = estimateCost(prices[r.model ?? ""], r._sum.inputTokens, r._sum.outputTokens);
    if (c != null) line.cost = (line.cost ?? 0) + c;
    else line.unpriced += r._sum.tokens ?? 0;
    byPurpose.set(k, line);
  }
  const purposes = [...byPurpose.values()].sort((a, b) => b.inTok + b.outTok - (a.inTok + a.outTok));
  const totalCost = purposes.reduce((n, p) => n + (p.cost ?? 0), 0);
  const anyPriced = purposes.some((p) => p.cost != null);
  const seenModels = [...new Set(purposeRows.map((r) => r.model).filter((m): m is string => !!m))];
  const priceModels = [...new Set([...MODELS.map((m) => m.id), ...seenModels])];

  // Per person this month — what the soft limits count (lib/soft-limits.ts).
  const [scriptsBy, thumbsBy, runsBy] = await Promise.all([
    db.script.groupBy({ by: ["authorId"], where: { channel: { workspaceId: ws }, createdAt: month, authorId: { not: null } }, _count: { _all: true } }),
    db.usageLog.groupBy({ by: ["actorId"], where: { workspaceId: ws, action: { in: THUMBNAIL_ACTIONS }, createdAt: month, actorId: { not: null } }, _count: { _all: true } }),
    db.usageLog.groupBy({ by: ["actorId"], where: { workspaceId: ws, action: AGENT_RUN_ACTION, createdAt: month, actorId: { not: null } }, _count: { _all: true } }),
  ]);
  const ranked = (rows: { id: string | null; n: number }[]) => rows.filter((r) => r.id).sort((a, b) => b.n - a.n);
  const scriptRank = ranked(scriptsBy.map((r) => ({ id: r.authorId, n: r._count._all })));
  const limits = [
    { label: "Scripts", cap: workspace.limitScriptsPerUserMonth, top: scriptRank[0] ?? null },
    { label: "Thumbnail sets", cap: workspace.limitThumbnailsPerUserMonth, top: ranked(thumbsBy.map((r) => ({ id: r.actorId, n: r._count._all })))[0] ?? null },
    { label: "Agent Mode runs", cap: workspace.limitAgentRunsPerUserMonth, top: ranked(runsBy.map((r) => ({ id: r.actorId, n: r._count._all })))[0] ?? null },
  ];
  const personIds = [...new Set([...scriptRank.slice(0, 5), ...limits.map((l) => l.top)].flatMap((r) => (r?.id ? [r.id] : [])))];
  const people = await db.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, email: true } });
  const who = (id: string | null | undefined) => { const u = people.find((p) => p.id === id); return u ? u.name ?? u.email : "someone"; };

  const ai = [...aiRows].sort((a, b) => (a.action === b.action ? b._count._all - a._count._all : a.action === "ai.text" ? -1 : 1));
  const imagesRendered = aiRows.filter((r) => r.action === "ai.image" && r.provider !== "mock").reduce((n, r) => n + r._count._all, 0);
  const placeholders = aiRows.filter((r) => r.provider === "mock").reduce((n, r) => n + r._count._all, 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}>
          <BarChart3 className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1">
          <h1 className="font-mono font-bold text-lg leading-tight">Usage</h1>
          <p className="text-xs text-[var(--mute)]">This month (UTC, from the 1st), what each AI provider was asked for, and the soft limits. Never paid.</p>
        </div>
        <Link href="/admin/limits" className="btn text-xs"><Gauge className="w-3.5 h-3.5" /> Soft limits</Link>
      </div>

      {/* This month, workspace totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Tile label="Active users (week)" value={activeUsers} color="#E5482F" icon={<Users className="w-4 h-4" />} />
        <Tile label="Channels" value={totalChannels} cap={workspace.limitChannels} color="#6D28D9" icon={<Sparkles className="w-4 h-4" />} />
        <Tile label="Articles / month" value={articles} color="#2563EB" icon={<FileText className="w-4 h-4" />} />
        <Tile label="Social posts / month" value={socialPosts} color="#0891B2" icon={<Share2 className="w-4 h-4" />} />
        <Tile label="AI images / month" value={imagesRendered} color="#D97706" icon={<ImageIcon className="w-4 h-4" />} />
        <Tile label="Scripts / month" value={scripts} color="#15924B" icon={<PenLine className="w-4 h-4" />} />
        <Tile label="Thumbnail sets / month" value={thumbnails} color="#DB2777" icon={<ImageIcon className="w-4 h-4" />} />
        <Tile label="Agent runs / month" value={agentRuns} color="#0D9488" icon={<Bot className="w-4 h-4" />} />
      </div>

      <p className="text-xs text-[var(--mute)] mb-4">
        YouTube Data API: <b className="font-mono">{ytToday.toLocaleString("en-GB")}</b> units today (UTC) · <b className="font-mono">{ytMonth.toLocaleString("en-GB")}</b>{" "}this month.
        A channel search costs 100, every other read 1; the key&apos;s daily pool (10,000 by default) may be shared with other workspaces.
      </p>

      {(ok || err) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>{ok ?? err}</p>
      )}

      {/* E-ENG-07: the month's tokens against a budget that warns */}
      <section className="card mb-4" id="ai-budget" data-ai-budget>
        <h2 className="font-mono font-bold text-[14px] mb-1">AI tokens this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          <b className="font-mono text-[var(--ink)]" data-used-tokens={usedTokens}>{usedTokens.toLocaleString("en-GB")}</b> tokens in and out since the 1st (UTC)
          {budget ? <> of a <b className="font-mono text-[var(--ink)]">{budget.toLocaleString("en-GB")}</b> budget — <b data-budget-pct={Math.floor(budgetPct)}>{Math.floor(budgetPct)}%</b></> : <> — no budget set</>}
          {anyPriced ? <> · about <b className="font-mono text-[var(--ink)]" data-total-cost>{formatUsd(totalCost)}</b> at the prices set</> : null}.
          {" "}Admins are told once at {BUDGET_THRESHOLDS.join("% and ")}%; nothing is stopped — the pause in Settings → Automation does that.
        </p>
        {budget ? (
          <div className="h-1.5 mb-3 rounded-full bg-[var(--line)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: Math.min(100, budgetPct) + "%", background: budgetPct >= 100 ? "var(--rose)" : budgetPct >= 80 ? "var(--amber)" : "var(--green)" }} />
          </div>
        ) : null}
        <form action={saveTokenBudgetAction} className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Monthly budget, tokens (blank for none)</span>
            <input name="budget" inputMode="numeric" defaultValue={budget ?? ""} placeholder="e.g. 5000000" className="w-44 font-mono text-xs border border-[var(--line-2)] rounded-lg px-2 py-1" />
          </label>
          <SubmitButton className="btn sm">Save budget</SubmitButton>
        </form>
      </section>

      {/* E-VID-06: video is billed by the second — counted per scene a real provider rendered */}
      <section className="card mb-4" id="video-budget" data-video-budget>
        <h2 className="font-mono font-bold text-[14px] mb-1">Video this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          <b className="font-mono text-[var(--ink)]" data-video-seconds={video.seconds}>{video.seconds.toLocaleString("en-GB")}</b> seconds rendered since the 1st (UTC)
          {video.usd != null ? <> · about <b className="font-mono text-[var(--ink)]">{usd(video.usd)}</b> at the prices set</> : null}
          {video.unpricedSeconds ? <> · {video.unpricedSeconds} s by a model with no price</> : null}
          {video.budget ? <> · budget <b className="font-mono text-[var(--ink)]">{video.budget.toLocaleString("en-GB")}</b> seconds — <b>{Math.floor(videoPct)}%</b></> : <> · no budget set</>}.
          {" "}Past the budget the engine renders nothing unattended; Render now still can, after showing the total. Placeholder renders cost nothing and aren&apos;t counted.
        </p>
        {video.budget ? (
          <div className="h-1.5 mb-3 rounded-full bg-[var(--line)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: Math.min(100, videoPct) + "%", background: videoPct >= 100 ? "var(--rose)" : videoPct >= 80 ? "var(--amber)" : "var(--green)" }} />
          </div>
        ) : null}
        <form action={saveVideoBudgetAction} className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Monthly budget, seconds of video (blank for none)</span>
            <input key={`vb:${video.budget ?? ""}`} name="budget" inputMode="numeric" defaultValue={video.budget ?? ""} placeholder="e.g. 600" className="w-44 font-mono text-xs border border-[var(--line-2)] rounded-lg px-2 py-1" />
          </label>
          <SubmitButton className="btn sm">Save video budget</SubmitButton>
        </form>
      </section>

      {/* E-ENG-07: what the tokens went on */}
      <section className="card mb-4" data-ai-purposes>
        <h2 className="font-mono font-bold text-[14px] mb-1">What the AI was asked for this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-3">
          Every text call names what it was for.{" "}
          {anyPriced
            ? "Cost is an estimate at the prices the platform operator set — not a bill; a dash means no model it used has a price. Input read from a provider's prompt cache is counted at the full input price, so it errs high."
            : "No model it used has a price set, so this shows tokens; the platform operator can add prices for an estimate."}{" "}
          Calls before 3 Nov 2026 weren&apos;t named.
        </p>
        {purposes.length === 0 ? (
          <p className="text-xs text-[var(--mute)] py-2">No AI text calls this month.</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {purposes.map((p) => (
              <li key={p.purpose ?? "none"} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs py-1.5 border-t border-[var(--line)] first:border-0" data-purpose={p.purpose ?? "none"}>
                <span className="font-semibold min-w-[12rem]">{purposeLabel(p.purpose)}</span>
                <span className="font-mono text-[11px] text-[var(--mute)] flex flex-wrap gap-x-3">
                  <span><b className="text-[var(--ink)]">{p.calls.toLocaleString("en-GB")}</b> call{p.calls === 1 ? "" : "s"}</span>
                  <span><b className="text-[var(--ink)]">{p.inTok.toLocaleString("en-GB")}</b> in</span>
                  <span><b className="text-[var(--ink)]">{p.outTok.toLocaleString("en-GB")}</b> out</span>
                  <span title={p.unpriced ? `${p.unpriced.toLocaleString("en-GB")} tokens on models with no price aren't in this` : undefined} data-purpose-cost>
                    {p.cost != null ? <>≈ <b className="text-[var(--ink)]">{formatUsd(p.cost)}</b>{p.unpriced ? " + unpriced" : ""}</> : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI by provider */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-1">AI by provider this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-3">
          {firstAiRow
            ? <>Counted from {firstAiRow.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}; calls before then weren&apos;t recorded. </>
            : <>Nothing recorded yet — every AI call is counted from now on. </>}
          Tokens are what the providers bill by; their prices are on each provider&apos;s billing page. A streamed reply reports no tokens.
          {placeholders > 0 && <> <b style={{ color: "var(--rose-on)" }}>{placeholders} placeholder {placeholders === 1 ? "reply" : "replies"}</b> — no key resolved, or the provider failed and the stand-in answered.</>}
        </p>
        {ai.length === 0 ? (
          <p className="text-xs text-[var(--mute)] py-2">No AI calls this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">
                  <th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">Provider</th><th className="py-1 pr-3">Model</th>
                  <th className="py-1 pr-3 text-right">Calls</th><th className="py-1 pr-3 text-right">Tokens in</th><th className="py-1 pr-3 text-right">Tokens out</th><th className="py-1 text-right">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {ai.map((r) => (
                  <tr key={`${r.action}:${r.provider}:${r.model}`} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-3">{r.action === "ai.image" ? "Image" : "Text"}</td>
                    <td className="py-1.5 pr-3">{PROVIDER_NAME[r.provider ?? ""] ?? r.provider ?? "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.action === "ai.text" && r.model ? modelLabel(r.model) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r._count._all.toLocaleString("en-GB")}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r._sum.inputTokens != null ? r._sum.inputTokens.toLocaleString("en-GB") : "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r._sum.outputTokens != null ? r._sum.outputTokens.toLocaleString("en-GB") : "—"}</td>
                    <td className="py-1.5 text-right font-mono">{rowEstimate(r.action === "ai.text" ? prices[r.model ?? ""] : undefined, r._sum.inputTokens, r._sum.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* E-ENG-07: the operator's prices — platform-wide, estimates only */}
      {operator && (
        <details className="card mb-4" data-model-prices>
          <summary className="font-mono font-bold text-[14px] cursor-pointer">Model prices (platform operator)</summary>
          <p className="text-[11px] text-[var(--mute)] mt-1 mb-3">
            Dollars per million tokens, from each provider&apos;s price page — every workspace&apos;s estimates use them. Leave both blank for a model with no price. Nothing is charged.
          </p>
          <form action={saveModelPricesAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="seen" value={seenModels.join(",")} />
            {priceModels.map((id) => (
              <div key={id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-[10rem] font-mono">{modelLabel(id)}</span>
                <label className="inline-flex items-center gap-1">in $<input name={`in:${id}`} inputMode="decimal" defaultValue={prices[id]?.in ?? ""} className="w-20 font-mono text-xs border border-[var(--line-2)] rounded-lg px-2 py-0.5" aria-label={`${id} input price per million tokens`} /></label>
                <label className="inline-flex items-center gap-1">out $<input name={`out:${id}`} inputMode="decimal" defaultValue={prices[id]?.out ?? ""} className="w-20 font-mono text-xs border border-[var(--line-2)] rounded-lg px-2 py-0.5" aria-label={`${id} output price per million tokens`} /></label>
              </div>
            ))}
            <div><SubmitButton className="btn sm mt-1">Save prices</SubmitButton></div>
          </form>
        </details>
      )}

      {/* E-VID-06: the operator's price per second of video — platform-wide, estimates only */}
      {operator && (
        <details className="card mb-4" data-video-prices>
          <summary className="font-mono font-bold text-[14px] cursor-pointer">Video prices (platform operator)</summary>
          <p className="text-[11px] text-[var(--mute)] mt-1 mb-3">
            Dollars per second of generated video, from the provider&apos;s price page — every board&apos;s estimate and the confirm before Render use them. Blank = no price (seconds only). Nothing is charged.
          </p>
          <form action={saveVideoPricesAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="models" value={videoModels.join(",")} />
            {videoModels.map((id) => (
              <label key={id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-[16rem] font-mono">{id}{id === VIDEO_MODEL ? " (renders now)" : ""}</span>
                $<input name={`vp:${id}`} inputMode="decimal" defaultValue={vPrices[id] ?? ""} className="w-24 font-mono text-xs border border-[var(--line-2)] rounded-lg px-2 py-0.5" aria-label={`${id} price per second`} /> a second
                {vPrices[id] != null ? <span className="text-[var(--mute)]">· an 8-second scene ≈ {usd(8 * vPrices[id])} (now {perSecondUsd(vPrices[id])}/s)</span> : null}
              </label>
            ))}
            <div><SubmitButton className="btn sm mt-1">Save video prices</SubmitButton></div>
          </form>
        </details>
      )}

      {/* Soft limits, per person */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-1">Soft limits this month</h2>
        <p className="text-[11px] text-[var(--mute)] mb-3">
          Each limit caps one person; the busiest person is shown against it. Someone at a limit is told so when they try to start another.{" "}
          <Link href="/admin/limits" className="underline">Change the limits</Link>
        </p>
        <ul className="m-0 p-0">
          {limits.map((l) => {
            const n = l.top?.n ?? 0;
            const pct = l.cap ? Math.min(100, Math.round((n / l.cap) * 100)) : 0;
            return (
              <li key={l.label} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="flex-1">{l.label} per person</span>
                  <span className="text-xs font-mono text-[var(--mute)]">
                    {l.top ? `${who(l.top.id)}: ${n}` : "nobody yet"}{l.cap ? ` of ${l.cap}` : " · no limit"}
                  </span>
                </div>
                {l.cap ? (
                  <div className="h-1 mt-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: pct + "%", background: pct >= 100 ? "var(--rose)" : pct > 80 ? "var(--brand)" : "var(--green)" }} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top users */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Top creators this month</h2>
          {scriptRank.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-2">No scripts created yet this month.</p>
          ) : (
            <ul className="m-0 p-0">
              {scriptRank.slice(0, 5).map((u, i) => (
                <li key={u.id} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-sm">
                  <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-mono font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{i + 1}</span>
                  <span className="flex-1">{who(u.id)}</span>
                  <span className="text-xs font-mono text-[var(--mute)]">{u.n} scripts</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--mute)] mt-2 font-mono">{formatNum(totalScripts)} total scripts in this workspace.</p>
        </section>

        {/* Recent activity */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Recent activity</h2>
          {recentUsageLogs.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-2">No tracked activity yet.</p>
          ) : (
            <ul className="m-0 p-0">
              {recentUsageLogs.map((log) => (
                <li key={log.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-xs flex items-center gap-2">
                  <span className="font-mono uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{log.action}</span>
                  <span className="flex-1">{log.model ?? "—"}</span>
                  <span className="text-[var(--mute)]">{formatZonedMoment(new Date(log.createdAt), postingTz)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** One provider row's estimate: "≈ $1.20", or a dash with no price (E-ENG-07). */
function rowEstimate(price: Parameters<typeof estimateCost>[0], inTok: number | null, outTok: number | null): string {
  const c = estimateCost(price, inTok, outTok);
  return c != null ? `≈ ${formatUsd(c)}` : "—";
}

function Tile({ label, value, cap, color, icon }: { label: string; value: number; cap?: number | null; color: string; icon: React.ReactNode }) {
  const pct = cap ? Math.min(100, Math.round((value / cap) * 100)) : 0;
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono font-bold text-2xl mt-1" style={{ color }}>{value.toLocaleString("en-GB")}{cap ? <span className="text-[11px] text-[var(--mute)] font-normal"> / {cap}</span> : null}</div>
      {cap ? (
        <div className="h-1 mt-2 rounded-full bg-[var(--line)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: pct + "%", background: pct > 80 ? "var(--brand)" : color }} />
        </div>
      ) : null}
    </div>
  );
}
