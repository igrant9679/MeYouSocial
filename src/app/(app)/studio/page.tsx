import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { studioState } from "@/lib/studio";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";

// Video stage (2026-11-19, the owner's "Name by format"): the studio's work in
// progress — scripts being written and renders running. Its pages (Scripts,
// Thumbnails, Renders, Production) were tabs of the retired Drafts stage, and
// this list was the lower half of that page. The rail shows Video only while
// the studio is shown; opened while it is off, this page says how to turn it on.

export default async function VideoStage() {
  const { workspace, membership } = await requireMembership();
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const { active } = await getActiveChannel();
  const admin = canAdmin(membership.role);
  const studio = await studioState(workspace.id);
  if (!studio.show) {
    return (
      <div>
        <StageHeader title="Video" sentence="The video studio isn't shown for this workspace." counts={[]} />
        <p className="text-sm mb-4 flex items-center gap-1.5">
          <Clapperboard className="w-4 h-4" />
          {studio.channels === 0
            ? <>Scripts, thumbnails, video renders and the production board appear here once a YouTube channel exists{admin ? <> — <Link href="/channels" className="underline">add one under Channels</Link></> : " (an admin adds one under Channels)"}.</>
            : <>The video studio is switched off for this workspace{admin ? <> — <Link href="/setup" className="underline">turn it on under Settings</Link></> : ""}. Nothing was deleted.</>}
        </p>
      </div>
    );
  }
  const [scripts, scriptCount, renders] = await Promise.all([
    db.script.findMany({
      where: { channel: { workspaceId: workspace.id }, status: "draft" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, title: true, workflow: true, wordCount: true, updatedAt: true, channel: { select: { name: true } } },
    }),
    db.script.count({ where: { channel: { workspaceId: workspace.id }, status: "draft" } }),
    db.videoRender.findMany({
      where: { workspaceId: workspace.id, status: { in: ["queued", "rendering"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, status: true, createdAt: true },
    }),
  ]);
  const scriptsHref = active ? `/channels/${active.id}/scripts` : "/scripts";

  return (
    <div>
      <StageHeader
        title="Video"
        sentence={
          scriptCount || renders.length
            ? `${scriptCount} script${scriptCount === 1 ? "" : "s"} being written${renders.length ? `, ${renders.length} render${renders.length === 1 ? "" : "s"} running` : ""}.`
            : "Nothing is being written or rendered right now."
        }
        counts={[
          { label: "scripts in draft", n: scriptCount, href: scriptsHref, hue: "green" },
          { label: "renders running", n: renders.length, href: "/videos", hue: "violet" },
        ]}
      />

      <StageList
        title="Scripts"
        empty={<EmptyState variant="inline" line="No script is being written right now." action={{ label: "Open Scripts", href: scriptsHref }} />}
      >
        {scripts.length > 0 ? scripts.map((s) => (
          <StageRow key={s.id}>
            <StateChip label={s.workflow} hue="green" />
            <div className="flex-1 min-w-48">
              <Link href={s.workflow === "builder" ? `/scripts/${s.id}/builder` : `/scripts/${s.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{s.title}</Link>
              <div className="text-2xs text-[var(--mute)]">{s.channel.name} · {s.wordCount} words · updated {s.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
            </div>
            <Link href={s.workflow === "builder" ? `/scripts/${s.id}/builder` : `/scripts/${s.id}`} className="btn sm">Open</Link>
          </StageRow>
        )) : undefined}
      </StageList>

      {renders.length > 0 && (
        <StageList title="Renders running">
          {renders.map((r) => (
            <StageRow key={r.id}>
              <StateChip label={r.status} hue={r.status === "rendering" ? "amber" : "violet"} />
              <div className="flex-1 min-w-48 text-sm">Render started {formatZonedMoment(r.createdAt, tz)}</div>
              <Link href={`/videos/${r.id}`} className="btn sm">Open</Link>
            </StageRow>
          ))}
        </StageList>
      )}
    </div>
  );
}
