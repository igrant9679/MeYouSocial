import Link from "next/link";
import { FileBarChart, Plus } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { createCustomReportAction } from "@/app/actions/reports";
import { listReports } from "@/lib/report-defs";

// The Reports hub: ten stock reports plus this workspace's custom ones. Every
// report is an ordered list of blocks — customizing writes a per-workspace
// override; stock defaults keep improving underneath untouched reports.

export default async function ReportsHubPage() {
  const { workspace, membership } = await requireMembership();
  const reports = await listReports(workspace.id);
  const editor = canEdit(membership.role);

  return (
    <main className="w-full max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
          <FileBarChart className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Reports</h1>
          <p className="text-xs text-[var(--mute)]">
            Ten stock reports, all customizable block by block — plus your own. Data is real rows only; blocks without
            data say so.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {reports.map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="card lift block">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `var(--${r.hue}-soft)`, color: `var(--${r.hue}-on)` }}>
                <FileBarChart className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <span className="font-semibold text-sm leading-tight flex-1">{r.name}</span>
              {r.isCustom && (
                <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>custom</span>
              )}
              {!r.isCustom && r.customized && (
                <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>customized</span>
              )}
            </div>
            <p className="text-xs text-[var(--mute)]">{r.description}</p>
            <p className="font-mono text-[10px] text-[var(--mute)] mt-1.5">{r.blocks.length} blocks · {r.dateRangeDays / 7}w range</p>
          </Link>
        ))}

        {editor && (
          <form action={createCustomReportAction} className="card border-dashed flex flex-col gap-2 justify-center" style={{ borderStyle: "dashed" }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--mute)]">
              <Plus className="w-4 h-4" /> New custom report
            </div>
            <input name="name" required placeholder="Report name" className="w-full text-xs" />
            <input name="description" placeholder="What it answers (optional)" className="w-full text-xs" />
            <div><SubmitButton className="btn sm">Create</SubmitButton></div>
          </form>
        )}
      </div>
    </main>
  );
}
