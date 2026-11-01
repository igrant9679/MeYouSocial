import { requireMembership, canEdit } from "@/lib/acl";
import Link from "next/link";
import { PostList, listFilterFrom } from "@/components/PostList";
import { socialQueuePause } from "@/lib/social/queue-pause";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatDay } from "@/lib/zoned-dates";

// Distribute → Queue (Socialmonials parity, 2026-10-17). The list itself lives
// in components/PostList.tsx so Queue, Sent and Drafts never drift apart.
export default async function SocialQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, membership } = await requireMembership();
  const sp = await searchParams;
  const [pause, tz] = await Promise.all([socialQueuePause(workspace.id), getPostingTimeZone(workspace.id).catch(() => "UTC")]);
  return (
    <>
      {/* A paused social queue (E-SOC-06): the list still shows what's waiting. */}
      {pause && (
        <div className="mx-6 mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }} data-queue-paused>
          <b>The social queue is paused</b> since {formatDay(new Date(pause.since), tz)}{pause.note ? ` — “${pause.note}”` : ""}. Nothing below goes out until it&apos;s resumed.{" "}
          <Link href="/setup/automation#social-queue" className="underline">Resume on Automation</Link>
        </div>
      )}
    <PostList
      tab="queue"
      workspaceId={workspace.id}
      editor={canEdit(membership.role)}
      filter={listFilterFrom(sp)}
      flash={{ ok: sp.ok, err: sp.err }}
    />
    </>
  );
}
