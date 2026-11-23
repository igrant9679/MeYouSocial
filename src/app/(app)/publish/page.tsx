import Link from "next/link";
import { requireMembership, canAdmin } from "@/lib/acl";
import { formatInZone, getPostingTimeZone } from "@/lib/social/slots";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getModes, isGloballyPaused } from "@/lib/governance";
import { blockingChecks } from "@/lib/blog-gates";
import { SubmitButton } from "@/components/SubmitButton";
import { advanceBlogStatusAction } from "@/app/actions/blog";
import { markPublishedManuallyAction } from "@/app/actions/blog-export";
import { Banner } from "@/components/SocialPostCard";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";
import { AddLiveLink } from "@/components/AddLiveLink";

// Articles stage (2026-11-19, the owner's "Name by format"; it was the Publish
// stage, and the article list of the Drafts stage): what is being written,
// what's at final approval and when it goes (the publish-day gate, or a
// hand-set date), and what went live. All articles, Audit, Website and the
// Calendar are its tabs.

const BLOG_HUE: Record<string, string> = { drafting: "amber", draft_review: "blue" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function PublishStage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const admin = canAdmin(membership.role);
  const tz = await getPostingTimeZone(workspace.id);
  const [ready, published, wp, publishDayRaw, modes, writing, counts, approvedIdeas, paused] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "final_approval" }, orderBy: { updatedAt: "asc" }, take: 10, select: { id: true, title: true, scheduledAt: true, wpPostId: true, refreshStartedAt: true, publishedUrl: true } }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "published" }, orderBy: { publishedAt: "desc" }, take: 6, select: { id: true, title: true, publishedAt: true, publishedUrl: true } }),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id }, select: { baseUrl: true } }),
    getSetting("autopilot:publish_day", workspace.id).catch(() => ""),
    getModes(workspace.id),
    // Being written — the list the Drafts stage held until 2026-11-19.
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["drafting", "draft_review"] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, updatedAt: true, body: true },
    }),
    db.blogPost.groupBy({ by: ["status"], where: { workspaceId: workspace.id, status: { in: ["drafting", "draft_review"] } }, _count: { _all: true } }),
    // ⚠ An empty list has to say WHY nothing is being written, and the app
    // knows which of the reasons it is (audit B6/D4): a pause, a manual mode,
    // or an empty pool of approved ideas. Naming the wrong one sends someone to
    // approve an idea that will then sit there because the pause is on.
    db.blogIdea.count({ where: { workspaceId: workspace.id, status: "approved" } }),
    isGloballyPaused(workspace.id),
  ]);
  // Ordered by which blocker actually dominates: a pause stops everything, a
  // manual mode stops the sweep, and only then does the pool matter.
  const notDrafting = paused
    ? { why: "the global pause is on, so no AI action runs at all", label: "Open Automation", href: "/setup/automation" }
    : modes.blog_drafting === "manual"
      ? { why: "blog drafting is set to manual, so it only runs when someone asks for it", label: "Open Automation", href: "/setup/automation" }
      : approvedIdeas === 0
        ? { why: "no idea has been approved yet — drafting only ever consumes approved ideas", label: "Approve an idea", href: "/ideas" }
        : null;
  const n = (st: string) => counts.find((c) => c.status === st)?._count._all ?? 0;
  // Published articles with no live link beyond the six above — admins can add it (2026-11-23).
  const unlinkedOlder = admin
    ? await db.blogPost.findMany({
        where: { workspaceId: workspace.id, status: "published", publishedUrl: null, id: { notIn: published.map((p) => p.id) } },
        orderBy: { publishedAt: "desc" },
        take: 20,
        select: { id: true, title: true, publishedAt: true, publishedUrl: true },
      })
    : [];
  const day = parseInt(publishDayRaw, 10);
  const publishDay = Number.isInteger(day) && day >= 0 && day <= 6 ? DAYS[day] : null;
  const auto = modes.publishing === "auto";
  // The checks are re-run at publish, so an article here can have stopped
  // passing since it arrived (an edit, a new marker). Say which check, rather
  // than "goes out on the next cycle" for an article that never will (ART-08).
  const held = new Map<string, string[]>();
  for (const p of ready) {
    const failing = await blockingChecks(workspace.id, p.id);
    if (failing?.length) held.set(p.id, failing);
  }

  return (
    <div>
      <StageHeader
        title="Articles"
        sentence={
          !wp
            ? "No website connected — articles reaching final approval park here. Download each as HTML, add it to your site by hand and mark it published, or connect WordPress under Website."
            : auto
              ? publishDay ? `Publishing is automatic: gate-passing articles go to ${wp.baseUrl} on ${publishDay}s.` : `Publishing is automatic: gate-passing articles go to ${wp.baseUrl} on the next cycle.`
              : `Publishing is ${modes.publishing}: a person sets the date or presses Publish.`
        }
        counts={[
          { label: "drafting", n: n("drafting"), href: "/blog?view=list", hue: "amber" },
          { label: "in review", n: n("draft_review"), href: "/inbox", hue: "blue" },
          { label: "at final approval", n: ready.length, hue: "blue" },
          { label: "published", n: published.length, href: "/blog", hue: "green" },
          { label: publishDay ? `publish day · ${publishDay}` : "publish day · any", n: null, href: "/setup/automation" },
        ]}
      />

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <StageList
        title="Being written"
        empty={
          <EmptyState
            variant="inline"
            line={notDrafting ? `No article is drafting: ${notDrafting.why}.` : approvedIdeas > 0 ? `No article is drafting or in review right now — ${approvedIdeas} approved idea${approvedIdeas === 1 ? " is" : "s are"} queued, and the autopilot drafts them on its weekly allowance.` : "No article is drafting or in review right now."}
            action={notDrafting ? { label: notDrafting.label, href: notDrafting.href } : { label: "See the approved ideas", href: "/ideas" }}
          />
        }
      >
        {writing.length > 0 ? writing.map((p) => (
          <StageRow key={p.id}>
            <StateChip label={p.status === "draft_review" ? "in review" : "drafting"} hue={BLOG_HUE[p.status] ?? "zebra"} />
            <div className="flex-1 min-w-48">
              <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
              <div className="text-2xs text-[var(--mute)]">
                {p.body ? `${Math.round(p.body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length)} words` : "no body yet"} · updated {p.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </div>
            </div>
            <Link href={`/blog/${p.id}`} className="btn sm">Open</Link>
          </StageRow>
        )) : undefined}
      </StageList>

      <StageList
        title="Waiting to go out"
        empty={<EmptyState variant="inline" tone="clear" line="Nothing is at final approval — articles arrive here once every required check passes." />}
      >
        {ready.length > 0 ? ready.map((p) => {
          // A refresh of an article published by hand goes out by hand, website or not.
          const byHand = !wp || (p.refreshStartedAt != null && p.wpPostId == null);
          return (
          <StageRow key={p.id}>
            <StateChip label="final approval" hue="blue" />
            <div className="flex-1 min-w-48">
              <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
              <div className="text-2xs text-[var(--mute)]">
                {held.has(p.id)
                  ? <span style={{ color: "var(--amber-on)" }}>held — no longer passes: {held.get(p.id)!.join("; ")}</span>
                  : !wp
                  ? "no website connected — cannot publish yet"
                  : byHand
                  ? `a refresh of an article published by hand — replace the page${p.publishedUrl ? ` at ${p.publishedUrl}` : ""} with this HTML, then mark it refreshed`
                  : p.wpPostId && !p.refreshStartedAt
                  // A hand-off waits as a DRAFT on the site (ART-10): never picked up
                  // again by the sweep, and not live until someone publishes it.
                  ? "handed off to WordPress as a draft — not live yet; Publish now publishes it there"
                  : p.scheduledAt
                    ? `set for ${formatInZone(p.scheduledAt, tz)} ${tz}`
                    : auto
                      ? publishDay ? `goes out ${publishDay} with the cycle` : "goes out on the next cycle"
                      : "waiting for a person"}
              </div>
            </div>
            {admin && wp && !byHand && (
              <form action={advanceBlogStatusAction}>
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn primary sm" pendingText="Publishing…" title={p.wpPostId && !p.refreshStartedAt ? "Publish the WordPress draft now and confirm it went live" : "Publish to WordPress now, ahead of the gate"}>Publish now</SubmitButton>
              </form>
            )}
            {/* The no-WordPress fallback: a self-contained HTML file (images
                embedded — the app's image URLs need a session and would break
                on a public site), and a way to record where it went live so
                the loop moves on. */}
            <a href={`/blog/${p.id}/export`} className="btn sm" title="A self-contained HTML file of this article — add it to any site by hand">Download HTML</a>
            <Link href={`/blog/${p.id}`} className="btn sm">Open</Link>
            {admin && byHand && (
              <form action={markPublishedManuallyAction} className="basis-full flex items-center gap-1.5 flex-wrap pt-1">
                <input type="hidden" name="id" value={p.id} />
                <input name="url" type="url" placeholder="https://… where it went live" defaultValue={p.refreshStartedAt ? p.publishedUrl ?? undefined : undefined} required className="text-xs min-w-64 flex-1" aria-label="Live URL" />
                <SubmitButton className="btn sm primary" pendingText="Recording…" title={p.refreshStartedAt ? "Record that the live page now has this revision" : "Record this article as published by hand — social variants and analytics key off it"}>{p.refreshStartedAt ? "Mark as refreshed" : "Mark as published"}</SubmitButton>
              </form>
            )}
          </StageRow>
          );
        }) : undefined}
      </StageList>
      {!wp && ready.length > 0 && (
        <p className="text-2xs text-[var(--mute)] -mt-2 mb-4">
          Download HTML gives a file that stands on its own: the article, its meta title and description, and its images embedded. Add it to your site, then Mark as published with the live link.
          {" "}Add <code>?fragment=1</code> to the download link for just the article body, for pasting into a CMS block.
        </p>
      )}

      {published.length > 0 && (
        <StageList title="Recently published">
          {published.map((p) => <PublishedRow key={p.id} p={p} admin={admin} />)}
        </StageList>
      )}
      {/* "Add live link" (2026-11-23): older published articles with no live
          link would otherwise be found only one by one; admins get them here. */}
      {unlinkedOlder.length > 0 && (
        <StageList title="Published without a live link">
          {unlinkedOlder.map((p) => <PublishedRow key={p.id} p={p} admin={admin} />)}
        </StageList>
      )}

    </div>
  );
}

/** One published article: its date and live link, or, for an admin, the box that adds the link it lacks. */
function PublishedRow({ p, admin }: { p: { id: string; title: string; publishedAt: Date | null; publishedUrl: string | null }; admin: boolean }) {
  return (
    <StageRow>
      <StateChip label="published" hue="green" />
      <div className="flex-1 min-w-48">
        <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
        <div className="text-2xs text-[var(--mute)]">
          {p.publishedAt?.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) ?? "—"}
          {!p.publishedUrl && <> · no live link in Publisher{admin ? "" : " — an admin can add it"}</>}
        </div>
      </div>
      {p.publishedUrl && <a href={p.publishedUrl} target="_blank" rel="noopener noreferrer" className="btn sm">View live ↗</a>}
      {admin && !p.publishedUrl && <AddLiveLink postId={p.id} back="publish" className="basis-full" />}
    </StageRow>
  );
}
