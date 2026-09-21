import Link from "next/link";
import { requireMembership, canEdit } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { intelThumbUrl, outlierBand, formatNum, formatVph } from "@/lib/intel";
import { ChannelAvatar } from "@/components/ChannelAvatar";
import { SubmitButton } from "@/components/SubmitButton";
import { addBlogIdeaAction } from "@/app/actions/blog-ideas";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Research stage: Intel (kept by name — the owner's decision), bookmarks, the
// tracked competitors, chat. The overview is the outliers that matter most
// right now, with the cross-stage act — turn one into an article idea —
// on the row.

export default async function ResearchStage() {
  const { workspace, membership } = await requireMembership();
  const { active } = await getActiveChannel();
  const editor = canEdit(membership.role);
  const [outliers, channels, bookmarks, indexedVideos] = await Promise.all([
    db.intelVideo.findMany({
      where: { intelChannel: { workspaceId: workspace.id }, outlierScore: { gte: 2 } },
      orderBy: { outlierScore: "desc" },
      take: 8,
      include: { intelChannel: { select: { id: true, name: true, thumbnailUrl: true } } },
    }),
    db.intelChannel.count({ where: { workspaceId: workspace.id } }),
    // A channel can be indexed with zero videos pulled (indexChannel swallows a
    // listVideos 404/403), and "nothing beat 2x" would then be a measurement
    // that never ran.
    db.intelVideo.count({ where: { intelChannel: { workspaceId: workspace.id } } }),
    db.bookmark.count({ where: { workspaceId: workspace.id } }),
  ]);

  return (
    <div>
      <StageHeader
        title="Research"
        sentence={channels ? `${channels} competitor channel${channels === 1 ? "" : "s"} indexed — the outliers below beat their own channel's average.` : "No competitor channels indexed yet — Intel is where they come in."}
        counts={[
          { label: "channels", n: channels, href: "/intel", hue: "blue" },
          { label: "strong outliers", n: outliers.length, href: "/intel", hue: "amber" },
          { label: "bookmarks", n: bookmarks, href: "/intel/bookmarks", hue: "rose" },
        ]}
      />

      <StageList
        title="Outlier videos worth an idea"
        empty={
          channels === 0
            ? <EmptyState variant="inline" line="No competitor channels are indexed yet, so there is nothing to compare." action={{ label: "Add a competitor", href: "/intel" }} />
            : indexedVideos === 0
              ? <EmptyState variant="inline" line={`${channels} competitor channel${channels === 1 ? " is" : "s are"} indexed, but no videos have been pulled from ${channels === 1 ? "it" : "them"} yet.`} note="Indexing skips a channel whose uploads are not public, or when the YouTube quota is spent — nothing has been measured, so nothing can be ruled out." action={{ label: "Open Intel", href: "/intel" }} />
              : <EmptyState variant="inline" line={`None of the ${indexedVideos} indexed videos has beaten its own channel's average by 2× yet.`} note="Outliers appear on their own as more of a competitor's videos are indexed." action={{ label: "Add a competitor", href: "/intel" }} />
        }
      >
        {outliers.length > 0 ? outliers.map((v) => {
          const band = outlierBand(v.outlierScore);
          const thumb = intelThumbUrl(v);
          return (
            <StageRow key={v.id}>
              {thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" className="w-20 h-11 rounded-md object-cover border border-[var(--line)] shrink-0" />
              )}
              <StateChip label={`${v.outlierScore?.toFixed(1)}× ${band.label}`} hue={band.label === "exceptional" ? "brand" : band.label === "strong" ? "amber" : "blue"} />
              {v.viewsPerHour != null && <StateChip label={`${formatVph(v.viewsPerHour)}/hr`} hue="zebra" />}
              <div className="flex-1 min-w-48">
                <Link href={`/intel/videos/${v.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{v.title}</Link>
                <div className="text-[11px] text-[var(--mute)] flex items-center gap-1.5">
                  <ChannelAvatar name={v.intelChannel.name} url={v.intelChannel.thumbnailUrl} size={16} />
                  {v.intelChannel.name} · {formatNum(v.views)} views · {v.format}
                </div>
              </div>
              {editor && (
                <form action={addBlogIdeaAction}>
                  <input type="hidden" name="title" value={v.title.slice(0, 200)} />
                  <SubmitButton className="btn sm" pendingText="Adding…" title="Add this as a blog idea on the Ideas board">Make it an idea</SubmitButton>
                </form>
              )}
              <Link href={`/intel/videos/${v.id}`} className="btn sm">Open</Link>
            </StageRow>
          );
        }) : undefined}
      </StageList>

    </div>
  );
}
