import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { SocialComposer, type ComposerInitial } from "@/components/SocialComposer";
import { formatInZone, getQueue, toZonedInput } from "@/lib/social/slots";
import { listCategories } from "@/lib/social/categories";
import { canWatermark } from "@/lib/social/watermark";
import { optimalTime } from "@/lib/social/optimal";
import { readTargetOptions } from "@/lib/social/platform-options";

// Editing an unsent post. Reuses the composer wholesale so per-network rules
// (char limits, variants, per-network images) behave identically to composing.
//
// Only draft | scheduled are editable: once a target has posted, the record is
// history and must keep saying what actually went out. Anything else opens the
// read-only post page (`/social/[id]`) instead of bouncing with an error (SOC-20).

const EDITABLE = new Set(["draft", "scheduled"]);

export default async function EditSocialPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireRole("EDITOR");

  const [post, accounts, topicRows, campaigns] = await Promise.all([
    db.socialPost.findFirst({ where: { id, workspaceId: workspace.id }, include: { targets: true } }),
    db.zernioAccount.findMany({
      where: { workspaceId: workspace.id, status: "connected" },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, displayName: true, username: true, accountId: true },
    }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, keywords: true },
    }),
    db.campaign.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);
  if (!post) notFound();
  if (!EDITABLE.has(post.status)) {
    redirect(`/social/${post.id}`);
  }

  // Targets store the Zernio account id; the picker works in local row ids.
  const byAccountId = new Map(accounts.map((a) => [a.accountId, a.id]));
  const selectedIds = post.targets.map((t) => byAccountId.get(t.accountId)).filter((x): x is string => Boolean(x));
  // Shape the rows the way the composer expects (provider = platform slug).
  const composerAccounts = accounts.map((a) => ({
    id: a.id,
    provider: a.platform,
    name: a.displayName ?? a.username,
  }));

  const variants: Record<string, string> = {};
  for (const t of post.targets) if (t.text) variants[t.provider.toUpperCase()] = t.text;
  // Same UPPERCASED keying as variants — the composer's rows and the action's
  // form fields both use it, and diverging silently drops the value.
  const subFormats: Record<string, string> = {};
  for (const t of post.targets) if (t.subFormat) subFormats[t.provider.toUpperCase()] = t.subFormat;
  const firstComments: Record<string, string> = {};
  for (const t of post.targets) if (t.firstComment) firstComments[t.provider.toUpperCase()] = t.firstComment;
  const ownMedia = [...new Set(post.targets.filter((t) => readJson<string[]>(t.mediaKeys, []).length > 0).map((t) => t.provider.toUpperCase()))];
  const tiktokTarget = post.targets.find((t) => t.provider.toLowerCase() === "tiktok");

  // Re-queueing ignores this post's own slot, so "Add to queue" on an already
  // queued post offers the slot it's in rather than bumping it down the line.
  const queue = await getQueue(workspace.id, { excludePostId: post.id, limit: 60 });

  const initial: ComposerInitial = {
    id: post.id,
    text: post.text,
    topicId: post.topicId,
    campaignId: post.campaignId,
    category: post.category,
    evergreen: post.evergreen,
    recycleEveryDays: post.recycleEveryDays,
    // Wall clock in the posting timezone — the zone the save reads it back in.
    scheduledAtLocal: post.scheduledAt ? toZonedInput(post.scheduledAt, queue.timeZone) : null,
    accountIds: selectedIds,
    variants,
    subFormats,
    existingMedia: readJson<string[]>(post.mediaKeys, []).length,
    firstComment: post.firstComment,
    linkToFirstComment: post.linkToFirstComment,
    watermark: post.watermark,
    firstComments,
    ownMedia,
    tiktok: tiktokTarget ? readTargetOptions(tiktokTarget.options).tiktok ?? null : null,
  };

  const nextFree = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;
  const slotCategories = [...new Set(queue.slots.map((s) => s.category).filter((c): c is string => Boolean(c)))];
  const [categories, watermarkAvailable, optimal] = await Promise.all([
    listCategories(workspace.id, [...slotCategories, post.category]),
    canWatermark(workspace.id),
    optimalTime(workspace.id, post.id).catch(() => ({ ok: false as const, reason: "The best-time report couldn't be read." })),
  ]);

  const droppedTargets = post.targets.length - selectedIds.length;

  return (
    <main className="w-full">
      <Link href="/social/calendar" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Calendar
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Pencil className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-xl leading-tight">Edit post</h1>
          <p className="text-xs text-[var(--mute)]">
            {post.status === "scheduled" && post.scheduledAt
              ? `Scheduled for ${formatInZone(post.scheduledAt, queue.timeZone)} (${queue.timeZone}). Saving keeps it scheduled unless you switch it back to a draft.`
              : "This is a draft. Saving won't send it — publishing stays an explicit act from the queue."}
          </p>
        </div>
      </div>

      {droppedTargets > 0 && (
        <div className="card mb-3 text-xs" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          {droppedTargets} of this post&apos;s target account{droppedTargets === 1 ? " is" : "s are"} no longer connected, so
          {droppedTargets === 1 ? " it isn't" : " they aren't"} pre-selected below. Saving now would drop
          {droppedTargets === 1 ? " that target" : " those targets"}.
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="card text-sm">
          No connected social accounts. Connect one under{" "}
          <Link href="/admin/connections" className="underline">Settings → Connections</Link> before editing targets.
        </div>
      ) : (
        <SocialComposer
          accounts={composerAccounts}
          topics={topicRows.map((t) => ({ id: t.id, name: t.name, keywords: readJson<string[]>(t.keywords, []) }))}
          campaigns={campaigns}
          categories={categories}
          approvalNotice={post.approval === "pending" || post.approval === "changes"}
          initial={initial}
          queue={{ nextFree, hasSlots: queue.slots.some((s) => s.enabled), timeZone: queue.timeZone }}
          watermarkAvailable={watermarkAvailable}
          optimal={optimal.ok ? { label: optimal.label, why: optimal.why } : { reason: optimal.reason }}
        />
      )}
    </main>
  );
}
