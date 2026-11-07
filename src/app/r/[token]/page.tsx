import type { Metadata } from "next";
import { db } from "@/lib/db";
import { openShare, brandingFor } from "@/lib/share-links";
import { reportContent } from "@/lib/report-pdf";

/**
 * A shared report (E-MEA-14): one report, read-only, in the workspace's own
 * colours and logo, for someone without an account. No sign-in; a wrong,
 * expired or turned-off link says only that it doesn't open — never which.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

function Closed() {
  return (
    <main className="min-h-screen grid place-items-center p-6" data-share-closed="">
      <div className="card max-w-md text-center">
        <h1 className="font-mono font-bold text-lg mb-1">This link doesn&apos;t open</h1>
        <p className="text-sm text-[var(--mute)] m-0">It may have expired or been turned off. Ask whoever sent it for a new one.</p>
      </div>
    </main>
  );
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await openShare(token);
  if (!share || share.kind !== "report") return <Closed />;
  const content = await reportContent(share.workspaceId, share.workspaceName, share.targetKey);
  if (!content) return <Closed />;
  const brand = await brandingFor(share.workspaceId, share.workspaceName);
  await db.shareLink.update({ where: { id: share.id }, data: { views: { increment: 1 }, lastViewedAt: new Date() } }).catch(() => {});
  const logo = brand.logo ? `data:image/png;base64,${brand.logo.toString("base64")}` : null;

  return (
    <main className="min-h-screen p-4 sm:p-8 bg-[var(--bg)]" data-shared-report="">
      <div className="w-full max-w-3xl mx-auto">
        <div className="h-1.5 rounded-full mb-5" style={{ background: brand.color }} />
        <header className="flex flex-wrap items-center gap-4 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URI, nothing to optimise */}
          {logo && <img src={logo} alt={`${brand.name} logo`} className="max-h-14 w-auto" data-share-logo="" />}
          <div className="flex-1 min-w-0">
            <h1 className="font-mono font-bold text-2xl leading-tight m-0" style={{ color: brand.color }}>{content.name}</h1>
            <p className="text-xs text-[var(--mute)] m-0">{brand.name} · the last {content.weeks} weeks · prepared {content.generated}</p>
          </div>
          <a href={`/r/${encodeURIComponent(token)}/pdf`} className="btn" data-share-pdf="">Download PDF</a>
        </header>
        <div className="flex flex-col gap-3">
          {content.sections.map((s, i) => (
            <section key={`${s.title}-${i}`} className="card">
              <h2 className="font-mono font-bold text-sm mb-2" style={{ color: brand.color }}>{s.title}</h2>
              {s.lines.map((l, j) => (
                <p key={j} className="text-sm m-0 py-0.5" style={l.muted ? { color: "var(--mute)" } : undefined}>{l.text}</p>
              ))}
            </section>
          ))}
        </div>
        <p className="text-2xs text-[var(--mute)] mt-4">{content.dataNote}</p>
        <p className="text-2xs text-[var(--mute)] mt-1">A read-only link{share.label ? ` for ${share.label}` : ""}, open until {share.expiresAt.toISOString().slice(0, 10)}.</p>
      </div>
    </main>
  );
}
