import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Download, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { ReportBlock } from "@/components/ReportBlocks";
import { BLOCK_KEYS, BLOCK_LABELS, getReport } from "@/lib/report-defs";
import {
  addReportBlockAction,
  deleteCustomReportAction,
  moveReportBlockAction,
  removeReportBlockAction,
  renameReportAction,
  resetReportAction,
  setReportRangeAction,
} from "@/app/actions/reports";

// One report: its blocks rendered in order, with the customize panel beside
// them. Customization is per-workspace; stock reports can always be reset.

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ customize?: string }>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const customizing = sp.customize === "1";
  const { workspace, membership } = await requireMembership();
  const report = await getReport(workspace.id, key);
  if (!report) notFound();
  const editor = canEdit(membership.role);
  const weeks = Math.max(1, Math.round(report.dateRangeDays / 7));
  const available = BLOCK_KEYS.filter((b) => !report.blocks.includes(b));

  return (
    <main className="w-full">
      <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Reports
      </Link>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">{report.name}</h1>
          <p className="text-xs text-[var(--mute)]">{report.description}</p>
        </div>
        {/* Range chips */}
        <div className="flex gap-1">
          {[28, 56, 84].map((d) => (
            <form key={d} action={setReportRangeAction}>
              <input type="hidden" name="key" value={report.key} />
              <input type="hidden" name="days" value={d} />
              <button
                className="font-mono text-[11px] font-bold px-2.5 py-1 rounded-full border cursor-pointer"
                style={
                  report.dateRangeDays === d
                    ? { background: "var(--accent-soft)", color: "var(--accent-on)", borderColor: "var(--accent)" }
                    : { background: "var(--bg)", color: "var(--mute)", borderColor: "var(--line-2)" }
                }
                disabled={!editor}
              >
                {d / 7}w
              </button>
            </form>
          ))}
        </div>
        <a href={`/reports/${report.key}/pdf`} className="btn" title="Download as PDF">
          <Download className="w-4 h-4" /> PDF
        </a>
        {editor && (
          <Link href={customizing ? `/reports/${report.key}` : `/reports/${report.key}?customize=1`} className="btn" aria-pressed={customizing}>
            <Settings2 className="w-4 h-4" /> {customizing ? "Done" : "Customize"}
          </Link>
        )}
      </div>

      <div className={customizing ? "grid grid-cols-1 @4xl:grid-cols-[1fr_260px] gap-4 items-start" : ""}>
        <div className="flex flex-col gap-3 min-w-0">
          {report.blocks.length === 0 ? (
            <div className="card text-center text-sm text-[var(--mute)] py-10">
              No blocks yet — open Customize and add some.
            </div>
          ) : (
            report.blocks.map((b) => <ReportBlock key={b} block={b} workspaceId={workspace.id} weeks={weeks} />)
          )}
        </div>

        {customizing && editor && (
          <aside className="card !p-3.5 sticky top-4">
            <h2 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--mute)] mb-2">Blocks</h2>
            <ul className="flex flex-col gap-1.5 mb-3">
              {report.blocks.map((b, i) => (
                <li key={b} className="flex items-center gap-1 text-xs border border-[var(--line)] rounded-lg px-2 py-1.5">
                  <span className="flex-1 font-semibold">{BLOCK_LABELS[b]}</span>
                  <form action={moveReportBlockAction}>
                    <input type="hidden" name="key" value={report.key} />
                    <input type="hidden" name="block" value={b} />
                    <input type="hidden" name="dir" value="up" />
                    <button className="btn !p-1" disabled={i === 0} aria-label={`Move ${BLOCK_LABELS[b]} up`}><ArrowUp className="w-3 h-3" /></button>
                  </form>
                  <form action={moveReportBlockAction}>
                    <input type="hidden" name="key" value={report.key} />
                    <input type="hidden" name="block" value={b} />
                    <input type="hidden" name="dir" value="down" />
                    <button className="btn !p-1" disabled={i === report.blocks.length - 1} aria-label={`Move ${BLOCK_LABELS[b]} down`}><ArrowDown className="w-3 h-3" /></button>
                  </form>
                  <form action={removeReportBlockAction}>
                    <input type="hidden" name="key" value={report.key} />
                    <input type="hidden" name="block" value={b} />
                    <button className="btn !p-1" aria-label={`Remove ${BLOCK_LABELS[b]}`}><X className="w-3 h-3" /></button>
                  </form>
                </li>
              ))}
            </ul>

            {available.length > 0 && (
              <form action={addReportBlockAction} className="flex items-center gap-1.5 mb-3">
                <input type="hidden" name="key" value={report.key} />
                <select name="block" className="text-xs flex-1">
                  {available.map((b) => <option key={b} value={b}>{BLOCK_LABELS[b]}</option>)}
                </select>
                <SubmitButton className="btn sm">Add</SubmitButton>
              </form>
            )}

            <form action={renameReportAction} className="flex items-center gap-1.5 mb-3">
              <input type="hidden" name="key" value={report.key} />
              <input name="name" defaultValue={report.name} className="text-xs flex-1" aria-label="Report name" />
              <SubmitButton className="btn sm">Rename</SubmitButton>
            </form>

            {!report.isCustom && report.customized && (
              <form action={resetReportAction}>
                <input type="hidden" name="key" value={report.key} />
                <SubmitButton className="btn sm w-full"><RotateCcw className="w-3 h-3" /> Reset to stock default</SubmitButton>
              </form>
            )}
            {report.isCustom && (
              <form action={deleteCustomReportAction}>
                <input type="hidden" name="key" value={report.key} />
                <SubmitButton className="btn sm w-full"><Trash2 className="w-3 h-3" /> Delete this report</SubmitButton>
              </form>
            )}
          </aside>
        )}
      </div>

      <p className="text-[11px] text-[var(--mute)] mt-4">
        Position and click data comes from snapshots recorded in this app and covers posts published through it.
        Connect Google Search Console (when available) for site-wide coverage.
      </p>
    </main>
  );
}
