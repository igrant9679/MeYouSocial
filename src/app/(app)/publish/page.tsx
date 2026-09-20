import Link from "next/link";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getModes } from "@/lib/governance";
import { SubmitButton } from "@/components/SubmitButton";
import { advanceBlogStatusAction } from "@/app/actions/blog";
import { markPublishedManuallyAction } from "@/app/actions/blog-export";
import { Banner } from "@/components/SocialPostCard";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Publish stage: what's at final approval, when it goes (the publish-day
// gate, or a hand-set date), and what went live. Website, the blog calendar
// and Automation are its tabs.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function PublishStage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const admin = canAdmin(membership.role);
  const [ready, published, wp, publishDayRaw, modes] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "final_approval" }, orderBy: { updatedAt: "asc" }, take: 10, select: { id: true, title: true, scheduledAt: true, wpPostId: true } }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "published" }, orderBy: { publishedAt: "desc" }, take: 6, select: { id: true, title: true, publishedAt: true, publishedUrl: true } }),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id }, select: { baseUrl: true } }),
    getSetting("autopilot:publish_day", workspace.id).catch(() => ""),
    getModes(workspace.id),
  ]);
  const day = parseInt(publishDayRaw, 10);
  const publishDay = Number.isInteger(day) && day >= 0 && day <= 6 ? DAYS[day] : null;
  const auto = modes.publishing === "auto";

  return (
    <div>
      <StageHeader
        title="Publish"
        sentence={
          !wp
            ? "No website connected — articles reaching final approval park here. Download each as HTML, add it to your site by hand and mark it published, or connect WordPress under Website."
            : auto
              ? publishDay ? `Publishing is automatic: gate-passing articles go to ${wp.baseUrl} on ${publishDay}s.` : `Publishing is automatic: gate-passing articles go to ${wp.baseUrl} on the next cycle.`
              : `Publishing is ${modes.publishing}: a person sets the date or presses Publish.`
        }
        counts={[
          { label: "at final approval", n: ready.length, hue: "blue" },
          { label: "published", n: published.length, href: "/blog", hue: "green" },
          { label: publishDay ? `publish day · ${publishDay}` : "publish day · any", n: null, href: "/setup/automation" },
        ]}
      />

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <StageList
        title="Waiting to go out"
        empty={<EmptyState variant="inline" tone="clear" line="Nothing is at final approval — articles arrive here once every required check passes." action={{ label: "See what's being written", href: "/drafts" }} />}
      >
        {ready.length > 0 ? ready.map((p) => (
          <StageRow key={p.id}>
            <StateChip label="final approval" hue="blue" />
            <div className="flex-1 min-w-48">
              <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
              <div className="text-[11px] text-[var(--mute)]">
                {!wp
                  ? "no website connected — cannot publish yet"
                  : p.scheduledAt
                    ? `set for ${p.scheduledAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : auto
                      ? publishDay ? `goes out ${publishDay} with the cycle` : "goes out on the next cycle"
                      : "waiting for a person"}
              </div>
            </div>
            {admin && wp && (
              <form action={advanceBlogStatusAction}>
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn primary sm" pendingText="Publishing…" title="Publish to WordPress now, ahead of the gate">Publish now</SubmitButton>
              </form>
            )}
            {/* The no-WordPress fallback: a self-contained HTML file (images
                embedded — the app's image URLs need a session and would break
                on a public site), and a way to record where it went live so
                the loop moves on. */}
            <a href={`/blog/${p.id}/export`} className="btn sm" title="A self-contained HTML file of this article — add it to any site by hand">Download HTML</a>
            <Link href={`/blog/${p.id}`} className="btn sm">Open</Link>
            {admin && !wp && (
              <form action={markPublishedManuallyAction} className="basis-full flex items-center gap-1.5 flex-wrap pt-1">
                <input type="hidden" name="id" value={p.id} />
                <input name="url" type="url" placeholder="https://… where it went live (optional)" className="text-xs min-w-64 flex-1" aria-label="Live URL" />
                <SubmitButton className="btn sm primary" pendingText="Recording…" title="Record this article as published by hand — social variants and analytics key off it">Mark as published</SubmitButton>
              </form>
            )}
          </StageRow>
        )) : undefined}
      </StageList>
      {!wp && ready.length > 0 && (
        <p className="text-[11px] text-[var(--mute)] -mt-2 mb-4">
          Download HTML gives a file that stands on its own: the article, its meta title and description, and its images embedded. Add it to your site, then Mark as published with the live link.
          {" "}Add <code>?fragment=1</code> to the download link for just the article body, for pasting into a CMS block.
        </p>
      )}

      {published.length > 0 && (
        <StageList title="Recently published">
          {published.map((p) => (
            <StageRow key={p.id}>
              <StateChip label="published" hue="green" />
              <div className="flex-1 min-w-48">
                <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
                <div className="text-[11px] text-[var(--mute)]">{p.publishedAt?.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) ?? "—"}</div>
              </div>
              {p.publishedUrl && <a href={p.publishedUrl} target="_blank" rel="noopener noreferrer" className="btn sm">View live ↗</a>}
            </StageRow>
          ))}
        </StageList>
      )}

    </div>
  );
}
