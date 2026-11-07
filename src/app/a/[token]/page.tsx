import type { Metadata } from "next";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { openShare, brandingFor } from "@/lib/share-links";
import { networkFor } from "@/lib/social/networks";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { SubmitButton } from "@/components/SubmitButton";
import { clientApproveAction, clientRequestChangesAction } from "@/app/actions/client-approval";

/**
 * A client's approval page (E-SOC-03): one held post, read-only, in the
 * workspace's colour and logo, with Approve and Ask for changes — no account.
 * A wrong, expired or used link says only that it doesn't open.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve a post", robots: { index: false, follow: false } };

function Note({ title, text, marker }: { title: string; text: string; marker: string }) {
  return (
    <main className="min-h-screen grid place-items-center p-6" data-approval-state={marker}>
      <div className="card max-w-md text-center">
        <h1 className="font-mono font-bold text-lg mb-1">{title}</h1>
        <p className="text-sm text-[var(--mute)] m-0">{text}</p>
      </div>
    </main>
  );
}

export default async function ClientApprovalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; err?: string }> }) {
  const { token } = await params;
  const { done, err } = await searchParams;
  if (done) return <Note title="Thank you" text={done} marker="done" />;
  const share = await openShare(token);
  if (!share || share.kind !== "post-approval") return <Note title="This link doesn't open" text="It may have expired, been turned off, or already been answered. Ask whoever sent it for a new one." marker="closed" />;
  const post = await db.socialPost.findFirst({ where: { id: share.targetKey, workspaceId: share.workspaceId }, include: { targets: { select: { provider: true, accountName: true } } } });
  if (!post || post.approval !== "pending") return <Note title="Nothing to approve" text="This post isn't waiting for approval any more." marker="decided" />;
  const [brand, tz] = await Promise.all([brandingFor(share.workspaceId, share.workspaceName), getPostingTimeZone(share.workspaceId)]);
  await db.shareLink.update({ where: { id: share.id }, data: { views: { increment: 1 }, lastViewedAt: new Date() } }).catch(() => {});

  // The post's pictures, embedded — our stored files are session-gated.
  let keys: string[] = [];
  try {
    keys = (JSON.parse(post.mediaKeys) as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 4);
  } catch {
    keys = [];
  }
  const pictures: string[] = [];
  for (const k of keys) {
    const bytes = await storage.get(k).catch(() => null);
    const b = bytes ? Buffer.from(bytes) : null;
    const mime = !b ? null : b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b.length > 12 && b.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : b[0] === 0x47 && b[1] === 0x49 ? "image/gif" : null;
    if (b && mime && b.byteLength < 6 * 1024 * 1024) pictures.push(`data:${mime};base64,${b.toString("base64")}`);
  }
  const logo = brand.logo ? `data:image/png;base64,${brand.logo.toString("base64")}` : null;
  const networks = [...new Set(post.targets.map((t) => `${networkFor(t.provider)?.label ?? t.provider}${t.accountName ? ` (${t.accountName})` : ""}`))];

  return (
    <main className="min-h-screen p-4 sm:p-8 bg-[var(--bg)]" data-approval-page="">
      <div className="w-full max-w-xl mx-auto">
        <div className="h-1.5 rounded-full mb-5" style={{ background: brand.color }} />
        <header className="flex items-center gap-3 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URI */}
          {logo && <img src={logo} alt={`${brand.name} logo`} className="max-h-12 w-auto" />}
          <div>
            <h1 className="font-mono font-bold text-xl m-0" style={{ color: brand.color }}>A post for your approval</h1>
            <p className="text-xs text-[var(--mute)] m-0">{brand.name}{share.label ? ` · for ${share.label}` : ""}</p>
          </div>
        </header>
        {err && <p className="card text-sm" style={{ borderColor: "var(--rose)", color: "var(--rose-on)" }}>{err}</p>}
        <article className="card mb-4" data-approval-post="">
          <p className="text-sm whitespace-pre-wrap m-0">{post.text}</p>
          {pictures.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URIs */}
              {pictures.map((src, i) => <img key={i} src={src} alt="" className="w-full rounded-lg" data-approval-picture="" />)}
            </div>
          )}
          <p className="text-2xs text-[var(--mute)] mt-3 mb-0">
            {networks.length ? `Goes to ${networks.join(", ")}` : "No account chosen yet"}
            {post.scheduledAt ? ` · planned for ${formatInZone(post.scheduledAt, tz)}` : ""}
          </p>
        </article>
        <div className="card flex flex-col gap-3">
          <form action={clientApproveAction} data-approval-approve="">
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="btn primary w-full" pendingText="Approving…">Approve</SubmitButton>
          </form>
          <form action={clientRequestChangesAction} className="flex flex-col gap-2" data-approval-changes="">
            <input type="hidden" name="token" value={token} />
            <textarea name="note" rows={3} maxLength={500} placeholder="What should change?" className="w-full text-sm border border-[var(--line-2)] rounded-lg p-2" aria-label="What should change" />
            <SubmitButton className="btn w-full" pendingText="Sending…">Ask for changes</SubmitButton>
          </form>
          <p className="text-2xs text-[var(--mute)] m-0">One answer per link. Open until {share.expiresAt.toISOString().slice(0, 10)}.</p>
        </div>
      </div>
    </main>
  );
}
