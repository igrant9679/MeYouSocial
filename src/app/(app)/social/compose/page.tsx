import Link from "next/link";
import { getUtmConfig } from "@/lib/social/utm";
import { PenSquare, FileUp } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { getSetting } from "@/lib/settings";
import { SocialComposer } from "@/components/SocialComposer";
import { storage } from "@/lib/storage";
import { HelpTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { formatInZone, getQueue } from "@/lib/social/slots";
import { listCategories } from "@/lib/social/categories";
import { canWatermark } from "@/lib/social/watermark";
import { optimalTime } from "@/lib/social/optimal";
import { SocialCsvImport } from "@/components/SocialCsvImport";
import { saveSnippetAction, deleteSnippetAction } from "@/app/actions/social-snippets";
import { Banner, SocialHeader } from "@/components/SocialPostCard";
import { DeleteButton } from "@/components/DeleteButton";

// Composing, and the bulk path that skips composing. Everything that CREATES a
// post lives here; everything that manages one lives on the other tabs.

type SP = { ok?: string; err?: string; media?: string | string[]; template?: string };

export default async function SocialComposePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err, media, template: templateId } = await searchParams;
  // ?media=<id>&media=<id> — images and videos picked on Distribute → Media.
  const mediaIds = (Array.isArray(media) ? media : media ? [media] : []).slice(0, 4);
  const picked = mediaIds.length
    ? await db.mediaItem.findMany({ where: { id: { in: mediaIds }, workspaceId: workspace.id }, select: { key: true, contentType: true } })
    : [];

  // E-SOC-09: the previews show links as the send will tag them.
  const utm = await getUtmConfig(workspace.id);
  const [accounts, topicRows, campaigns, queue, requireApproval] = await Promise.all([
    db.zernioAccount.findMany({
      where: { workspaceId: workspace.id, status: "connected" },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, displayName: true, username: true },
    }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, keywords: true },
    }),
    db.campaign.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
    }),
    getQueue(workspace.id),
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
  ]);

  const topics = topicRows.map((t) => ({ id: t.id, name: t.name, keywords: readJson<string[]>(t.keywords, []) }));
  // Composer works in {id, provider, name}; `provider` is the Zernio platform slug.
  const composerAccounts = accounts.map((a) => ({
    id: a.id,
    provider: a.platform,
    name: a.displayName ?? a.username,
  }));
  const nextFreeLabel = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;
  const hasSlots = queue.slots.some((s) => s.enabled);
  // The workspace's categories (Socialmonials' defaults until it saves its
  // own), with any slot lane that isn't on the list yet.
  const slotCategories = [...new Set(queue.slots.map((s) => s.category).filter((c): c is string => Boolean(c)))];
  // Post templates (E-SOC-23): ?template=<id> starts a new post from one.
  const templates = await db.socialTemplate.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true, text: true, firstComment: true, category: true, mediaKeys: true } });
  const template = templateId ? templates.find((t) => t.id === templateId) ?? null : null;
  // Only images still in this workspace's library come along.
  const templateKeys = template ? readJson<string[]>(template.mediaKeys, []).slice(0, 4) : [];
  const templateMedia = templateKeys.length ? await db.mediaItem.findMany({ where: { workspaceId: workspace.id, key: { in: templateKeys } }, select: { key: true, contentType: true } }) : [];
  const snippets = await db.socialSnippet.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true, body: true, category: true } });
  const [categories, watermarkAvailable, optimal] = await Promise.all([
    listCategories(workspace.id, slotCategories),
    canWatermark(workspace.id),
    optimalTime(workspace.id).catch(() => ({ ok: false as const, reason: "The best-time report couldn't be read." })),
  ]);

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<PenSquare className="w-6 h-6" strokeWidth={2.25} />}
        title="Compose"
        blurb="Write once, tailor per network, then send now, on a date, or into the next free slot."
      >
        <Link href="/social/calendar" className="btn sm">Calendar</Link>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}
      {template && <Banner kind="ok" text={`Started from the template “${template.name}” — choose the accounts, change anything, then send or save.${templateMedia.length < templateKeys.length ? " An image it used is no longer in Media, so it's left out." : ""}`} />}
      {templateId && !template && <Banner kind="err" text="That template isn't here any more." />}

      {accounts.length === 0 && (
        <div className="card mb-4 text-xs" style={{ borderColor: "var(--amber)" }}>
          No connected accounts, so there is nowhere to send yet.{" "}
          <Link href="/admin/connections" className="underline">Connect an account</Link> first — you can still write
          and save drafts.
        </div>
      )}

      <SocialComposer
        accounts={composerAccounts}
        topics={topics}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, color: c.color, utmCampaign: c.utmCampaign }))}
        utm={utm}
        categories={categories}
        approvalNotice={requireApproval && !canAdmin(membership.role)}
        queue={{ nextFree: nextFreeLabel, hasSlots, timeZone: queue.timeZone }}
        watermarkAvailable={watermarkAvailable}
        preloadMedia={(template ? templateMedia : picked).map((m) => ({ key: m.key, url: storage.url(m.key), video: !!m.contentType?.startsWith("video/") }))}
        seed={template ? { text: template.text, firstComment: template.firstComment, category: template.category } : undefined}
        optimal={optimal.ok ? { label: optimal.label, why: optimal.why } : { reason: optimal.reason }}
        snippets={snippets}
      />

      {/* Post templates (E-SOC-23): saved from a post's page; Use starts a new post with its content. */}
      <details id="templates" className="card mb-4 scroll-mt-20" open={templates.length > 0 && !template} data-templates>
        <summary className="cursor-pointer text-sm font-semibold">Templates <span className="font-normal text-[var(--mute)]">({templates.length})</span></summary>
        {templates.length === 0 ? (
          <p className="text-xs text-[var(--mute)] mt-2 mb-0">None yet. Open any post and press <b>Save as template</b> — its words, first comment, images and category become a starting point here.</p>
        ) : (
          <ul className="m-0 p-0 mt-2 flex flex-col gap-1.5 list-none">
            {templates.map((t) => (
              <li key={t.id} className="text-xs flex items-start gap-2 border-t border-[var(--line)] first:border-t-0 pt-1.5" data-template={t.id}>
                <b className="shrink-0">{t.name}</b>
                <span className="flex-1 text-[var(--mute)] whitespace-pre-wrap line-clamp-2">{t.text || "(images only)"}</span>
                <Link href={`/social/compose?template=${t.id}`} className="btn sm">Use</Link>
                <DeleteButton kind="socialTemplate" id={t.id} name={t.name} returnTo="/social/compose" iconOnly />
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* Saved hashtag sets and snippets (E-SOC-10) — offered under the post text above. */}
      <details id="snippets" className="card mb-6 scroll-mt-20" data-snippet-manager>
        <summary className="cursor-pointer text-sm font-semibold">Saved hashtag sets and snippets <span className="font-normal text-[var(--mute)]">({snippets.length})</span></summary>
        {snippets.length > 0 && (
          <ul className="m-0 p-0 mt-2 flex flex-col gap-1.5">
            {snippets.map((sn) => (
              <li key={sn.id} className="text-xs flex items-start gap-2 border-t border-[var(--line)] first:border-t-0 pt-1.5">
                <b className="shrink-0">{sn.name}</b>
                {sn.category && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{sn.category}</span>}
                <span className="flex-1 text-[var(--mute)] whitespace-pre-wrap line-clamp-2">{sn.body}</span>
                <form action={deleteSnippetAction}>
                  <input type="hidden" name="id" value={sn.id} />
                  <button className="btn sm" title="Delete this snippet">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {(
          <form action={saveSnippetAction} className="mt-3 flex flex-col gap-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <input name="name" required maxLength={60} placeholder="Name — e.g. Brand hashtags" className="text-xs flex-1 min-w-40" />
              <select name="category" defaultValue="" className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Offered for">
                <option value="">every post</option>
                {categories.map((c) => <option key={c} value={c}>only {c} posts</option>)}
              </select>
            </div>
            <textarea name="body" required maxLength={2000} rows={2} placeholder="#solar #renewables #homeenergy" className="w-full border border-[var(--line-2)] rounded-lg p-2 text-xs" />
            <div><button className="btn sm">Save snippet</button></div>
          </form>
        )}
      </details>

      {/* Bulk import — the path for a month of content in one sitting. */}
      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <FileUp className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
          Import from CSV
          <HelpTip text={SOCIAL_TIPS.csvImport} side="bottom" wide />
        </summary>
        <p className="text-[11px] text-[var(--mute)] mt-2 mb-2 leading-relaxed">
          One post per row, up to 200 rows. Header row required; columns:{" "}
          <code className="font-mono">text</code> (required),{" "}
          <code className="font-mono">scheduledAt</code> (as 2026-08-10 09:00, read in {queue.timeZone}; other date shapes are refused),{" "}
          <code className="font-mono">networks</code> (e.g. facebook|linkedin — empty = all),{" "}
          <code className="font-mono">campaign</code> (by name),{" "}
          <code className="font-mono">category</code>,{" "}
          <code className="font-mono">evergreen</code> (true/false),{" "}
          <code className="font-mono">recycleEveryDays</code>,{" "}
          <code className="font-mono">timezone</code> (e.g. America/New_York, for that row&apos;s date),{" "}
          <code className="font-mono">media</code> (names from the media library, a|b). Rows without a date land as drafts.
          Check the file first: every row is judged and nothing is written.
        </p>
        <SocialCsvImport />
      </details>
    </div>
  );
}
