import Link from "next/link";
import { requireMembership, canEdit } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { intelThumbUrl, outlierBand, formatNum, formatVph } from "@/lib/intel";
import { matchTopic, prepareTopics } from "@/lib/topic-match";
import { studioState } from "@/lib/studio";
import { ChannelAvatar } from "@/components/ChannelAvatar";
import { ResearchIdeaForm } from "@/components/ResearchIdeaForm";
import { StageHeader, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Research stage: Intel (kept by name — the owner's decision), bookmarks, the
// tracked competitors. The overview is the outliers that matter most right
// now, GROUPED BY TOPIC since 2026-09-21 ("Topics as the spine"), with the
// cross-stage act on the row: make one an article, video or social idea,
// tagged with its Topic.
//
// The grouping is a keyword match (lib/topic-match.ts) computed at render and
// labelled "matched by keyword". It is never stored: a stored guess would be
// a number this app invented.

export default async function ResearchStage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { active } = await getActiveChannel();
  const { ok } = await searchParams;
  const editor = canEdit(membership.role);
  const [outliers, channels, bookmarks, indexedVideos, topics, studio, ownChannels] = await Promise.all([
    db.intelVideo.findMany({
      where: { intelChannel: { workspaceId: workspace.id }, outlierScore: { gte: 2 } },
      orderBy: { outlierScore: "desc" },
      take: 24,
      include: { intelChannel: { select: { id: true, name: true, thumbnailUrl: true } } },
    }),
    db.intelChannel.count({ where: { workspaceId: workspace.id } }),
    // A channel can be indexed with zero videos pulled (indexChannel swallows a
    // listVideos 404/403), and "nothing beat 2x" would then be a measurement
    // that never ran.
    db.intelVideo.count({ where: { intelChannel: { workspaceId: workspace.id } } }),
    db.bookmark.count({ where: { workspaceId: workspace.id } }),
    db.topic.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: [{ priority: "desc" }, { name: "asc" }], select: { id: true, name: true, keywords: true } }),
    studioState(workspace.id),
    db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  const videoChannels = studio.show ? ownChannels : [];
  const prepared = prepareTopics(topics);
  const matched = new Map<string | null, typeof outliers>();
  for (const v of outliers) {
    const m = matchTopic(v.title, prepared);
    const key = m?.id ?? null;
    matched.set(key, [...(matched.get(key) ?? []), v]);
  }
  const groups: Array<{ topic: { id: string; name: string } | null; rows: typeof outliers }> = [
    ...topics.map((t) => ({ topic: { id: t.id, name: t.name }, rows: matched.get(t.id) ?? [] })),
    ...(matched.get(null)?.length ? [{ topic: null, rows: matched.get(null)! }] : []),
  ];
  const topicOptions = topics.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div>
      <StageHeader
        title="Research"
        sentence={channels ? `${channels} competitor channel${channels === 1 ? "" : "s"} indexed — the outliers below beat their own channel's average${topics.length ? ", grouped under the Topic they match" : ""}.` : "No competitor channels indexed yet — Intel is where they come in."}
        counts={[
          { label: "channels", n: channels, href: "/intel", hue: "blue" },
          { label: "strong outliers", n: outliers.length, href: "/intel", hue: "amber" },
          { label: "bookmarks", n: bookmarks, href: "/intel/bookmarks", hue: "rose" },
          { label: "topics", n: topics.length, href: "/ideas/topics", hue: "violet" },
        ]}
      />

      {ok && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{ok} <Link href="/ideas" className="underline">Open the board</Link></p>}

      {outliers.length === 0 ? (
        <div className="card">
          <h2 className="font-mono text-[14px] font-bold mb-2">Outlier videos worth an idea</h2>
          {channels === 0
            ? <EmptyState variant="inline" line="No competitor channels are indexed yet, so there is nothing to compare." action={{ label: "Add a competitor", href: "/intel" }} />
            : indexedVideos === 0
              ? <EmptyState variant="inline" line={`${channels} competitor channel${channels === 1 ? " is" : "s are"} indexed, but no videos have been pulled from ${channels === 1 ? "it" : "them"} yet.`} note="Indexing skips a channel whose uploads are not public, or when the YouTube quota is spent — nothing has been measured, so nothing can be ruled out." action={{ label: "Open Intel", href: "/intel" }} />
              : <EmptyState variant="inline" line={`None of the ${indexedVideos} indexed videos has beaten its own channel's average by 2× yet.`} note="Outliers appear on their own as more of a competitor's videos are indexed." action={{ label: "Add a competitor", href: "/intel" }} />}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {topics.length === 0 && (
            <p className="text-[11px] text-[var(--mute)] m-0">
              No Topics yet, so nothing groups these. <Link href="/ideas/topics" className="underline">Add a Topic</Link> and each outlier lands under the one it matches.
            </p>
          )}
          {groups.map((g) => (
            <section key={g.topic?.id ?? "unmatched"} className="card">
              <h2 className="font-mono text-[13px] font-bold mb-0.5 flex items-center gap-2 flex-wrap">
                {g.topic ? <Link href={`/ideas/topics/${g.topic.id}`} className="hover:underline">{g.topic.name}</Link> : "Unmatched"}
                <span className="font-mono text-[11px] font-normal text-[var(--mute)]">{g.rows.length}</span>
                {g.topic && g.rows.length > 0 && <span className="text-[10px] font-normal text-[var(--mute)]">matched by keyword</span>}
              </h2>
              {g.rows.length === 0 ? (
                <p className="text-[11px] text-[var(--mute)] py-1 m-0">
                  Nothing indexed about this yet — <Link href="/intel" className="underline">add a competitor</Link> that covers it, or add its phrases on <Link href="/ideas/topics" className="underline">Topics</Link> so more titles match.
                </p>
              ) : (
                <div className="mt-2">
                  {g.rows.map((v) => {
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
                        {editor && <ResearchIdeaForm videoId={v.id} topics={topicOptions} channels={videoChannels} matchedTopicId={g.topic?.id ?? null} back="/research" compact />}
                        <Link href={`/intel/videos/${v.id}`} className="btn sm">Open</Link>
                      </StageRow>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
          {g_unmatchedNote(groups)}
        </div>
      )}
    </div>
  );
}

function g_unmatchedNote(groups: Array<{ topic: unknown; rows: unknown[] }>) {
  const unmatched = groups.find((g) => g.topic === null);
  if (!unmatched || groups.length < 2) return null;
  return (
    <p className="text-[11px] text-[var(--mute)] m-0">
      Unmatched means no Topic's name or phrases appear in the title — the chooser on each row still takes any Topic.
    </p>
  );
}
