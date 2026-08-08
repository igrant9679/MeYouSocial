import Link from "next/link";
import { PenSquare, FileUp } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { getSetting } from "@/lib/settings";
import { SocialComposer } from "@/components/SocialComposer";
import { SubmitButton } from "@/components/SubmitButton";
import { HelpTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { formatInZone, getQueue } from "@/lib/social/slots";
import { importSocialCsvAction } from "@/app/actions/social-workflow";
import { Banner, SocialHeader } from "@/components/SocialPostCard";

// Composing, and the bulk path that skips composing. Everything that CREATES a
// post lives here; everything that manages one lives on the other tabs.

type SP = { ok?: string; err?: string };

export default async function SocialComposePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;

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
  // Slot categories that actually exist drive the composer's picker.
  const slotCategories = [...new Set(queue.slots.map((s) => s.category).filter((c): c is string => Boolean(c)))];

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
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        categories={slotCategories}
        approvalNotice={requireApproval && !canAdmin(membership.role)}
        queue={{ nextFree: nextFreeLabel, hasSlots }}
      />

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
          <code className="font-mono">scheduledAt</code> (e.g. 2026-08-10T09:00),{" "}
          <code className="font-mono">networks</code> (e.g. facebook|linkedin — empty = all),{" "}
          <code className="font-mono">campaign</code> (by name),{" "}
          <code className="font-mono">category</code>,{" "}
          <code className="font-mono">evergreen</code> (true/false),{" "}
          <code className="font-mono">recycleEveryDays</code>. Rows without a date land as drafts.
        </p>
        <form action={importSocialCsvAction} className="flex flex-wrap items-center gap-2" encType="multipart/form-data">
          <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
          <SubmitButton className="btn sm" pendingText="Importing…">Import</SubmitButton>
        </form>
      </details>
    </div>
  );
}
