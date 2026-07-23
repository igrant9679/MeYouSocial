import Link from "next/link";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  auditItemToIdeaAction,
  clearContentAuditAction,
  runContentAuditAction,
  setAuditItemStatusAction,
} from "@/app/actions/content-audit";
import { RECOMMENDATION_HUE, parseFindings, type Recommendation } from "@/lib/content-audit";

// FR-15 — the existing-content audit. Recommendations only: this page cannot
// delete, rewrite or republish anything on the live site.

export default async function ContentAuditPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const [items, conn] = await Promise.all([
    db.contentAuditItem.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { slopScore: "desc" }],
      take: 300,
    }),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  const open = items.filter((i) => i.status === "open");
  const counts = (["rewrite", "merge", "retire", "keep"] as const).map((r) => ({
    r,
    n: open.filter((i) => i.recommendation === r).length,
  }));
  const lastRun = items.reduce<Date | null>((acc, i) => (!acc || i.auditedAt > acc ? i.auditedAt : acc), null);

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
          <ScanSearch className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40">
          <h1 className="font-mono font-bold text-2xl leading-tight">Content audit</h1>
          <p className="text-xs text-[var(--mute)]">
            Read-only scan of what&apos;s already live. Nothing here changes your site — a retire recommendation always
            means redirect, never delete.
          </p>
        </div>
      </div>

      <div className="card mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {editor && (
            <form action={runContentAuditAction}>
              <SubmitButton className="btn primary" pendingText="Crawling…">
                {items.length ? "Re-run audit" : "Run audit"}
              </SubmitButton>
            </form>
          )}
          {canAdmin(membership.role) && items.length > 0 && (
            <form action={clearContentAuditAction}>
              <SubmitButton className="btn">Clear results</SubmitButton>
            </form>
          )}
          {lastRun && (
            <span className="font-mono text-[11px] text-[var(--mute)]">
              last run {lastRun.toISOString().slice(0, 16).replace("T", " ")}
            </span>
          )}
        </div>
        {!conn && (
          <p className="text-xs" style={{ color: "var(--amber-on)" }}>
            No WordPress connection — the audit will fall back to fetching the pages in your site inventory, which is
            slower and sees less.
          </p>
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {counts.map(({ r, n }) => (
              <span
                key={r}
                className="font-mono text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: `var(--${RECOMMENDATION_HUE[r]}-soft)`, color: `var(--${RECOMMENDATION_HUE[r]}-on)` }}
              >
                {n} {r}
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-[var(--mute)]">
          Search Console isn&apos;t connected, so ranking data only exists for posts published through this app.
          Everything else is scored on content quality alone — weigh that before retiring anything.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="text-xs text-[var(--mute)]">
            No audit yet. Running one crawls your published posts and scores them with the same checks the pre-publish
            gate uses.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const hue = RECOMMENDATION_HUE[item.recommendation as Recommendation] ?? "cyan";
            const findings = parseFindings(item.findings);
            return (
              <li key={item.id} className="card" style={item.status !== "open" ? { opacity: 0.6 } : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                  >
                    {item.recommendation}
                  </span>
                  <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold underline flex-1 min-w-40">
                    {item.title}
                  </a>
                  {item.slopScore != null && (
                    <span className="font-mono text-[10px] text-[var(--mute)]">score {item.slopScore}</span>
                  )}
                  {item.wordCount != null && (
                    <span className="font-mono text-[10px] text-[var(--mute)]">{item.wordCount}w</span>
                  )}
                  {item.position != null && (
                    <span className="font-mono text-[10px] text-[var(--mute)]">pos {item.position.toFixed(1)}</span>
                  )}
                  {item.status !== "open" && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                      {item.status}
                    </span>
                  )}
                </div>

                {item.reason && <p className="text-xs text-[var(--mute)] mt-1">{item.reason}</p>}

                {findings.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 mt-1.5">
                    {findings.map((f) => (
                      <li
                        key={f.label}
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "var(--panel)", color: "var(--mute)" }}
                        title={`+${f.weight} to the score`}
                      >
                        {f.label}: {f.detail}
                      </li>
                    ))}
                  </ul>
                )}

                {editor && item.status === "open" && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {item.recommendation !== "keep" && (
                      <form action={auditItemToIdeaAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="btn text-[11px]">Send to idea board</SubmitButton>
                      </form>
                    )}
                    <form action={setAuditItemStatusAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="status" value="dismissed" />
                      <button className="btn text-[11px]">Dismiss</button>
                    </form>
                  </div>
                )}
                {editor && item.status !== "open" && (
                  <form action={setAuditItemStatusAction} className="mt-2">
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="status" value="open" />
                    <button className="btn text-[11px]">Reopen</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
