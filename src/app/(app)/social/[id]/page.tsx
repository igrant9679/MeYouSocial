import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy, ExternalLink, Eye, Pencil, RotateCw } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { networkFor } from "@/lib/social/networks";
import { subFormatLabel } from "@/lib/social/sub-formats";
import { mayHavePosted } from "@/lib/social/unknown-outcome";
import { formatInZone, getPostingTimeZone } from "@/lib/social/slots";
import { DELETABLE_POST_STATUSES } from "@/lib/social/post-lists";
import { duplicateSocialPostAction, publishNowAction } from "@/app/actions/social";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { MediaThumbs, STATUS_STYLE } from "@/components/SocialPostCard";

// One post, read-only: what went out, where, and what each network said.
// Sent posts used to have no page at all — Distribute's "Open" bounced to the
// editor, which refuses them (SOC-20). The record is never edited here; a
// failed or partly-posted post can be retried, and any post duplicated.

type SP = { ok?: string; err?: string };

export default async function SocialPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);

  const [post, tz] = await Promise.all([
    db.socialPost.findFirst({
      where: { id, workspaceId: workspace.id },
      include: {
        targets: { orderBy: { provider: "asc" } },
        topic: { select: { name: true } },
        campaign: { select: { name: true } },
      },
    }),
    getPostingTimeZone(workspace.id),
  ]);
  if (!post) notFound();

  const st = STATUS_STYLE[post.status] ?? STATUS_STYLE.draft;
  const unsent = post.status === "draft" || post.status === "scheduled";
  const canRetry = editor && (post.status === "failed" || post.status === "partial");
  const unsure = [...new Set(post.targets.filter((t) => t.status === "failed" && mayHavePosted(t.error)).map((t) => networkFor(t.provider)?.label ?? t.provider))];
  const here = `/social/${post.id}`;
  const name = post.text.replace(/\s+/g, " ").trim().slice(0, 60) || "(image only)";

  return (
    <main className="w-full max-w-4xl">
      <Link href="/social/sent" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Sent
      </Link>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Eye className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-xl leading-tight flex items-center gap-2">
            Post
            <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
          </h1>
          <p className="text-xs text-[var(--mute)]">
            {post.publishedAt ? `Sent ${formatInZone(post.publishedAt, tz)}` : post.scheduledAt ? `Scheduled for ${formatInZone(post.scheduledAt, tz)}` : "Not sent"}
            {post.topic && <> · {post.topic.name}</>}
            {post.campaign && <> · campaign {post.campaign.name}</>}
            {!unsent && " · what went out is the record, so it can't be edited"}
          </p>
        </div>
        {editor && (
          <div className="flex flex-wrap gap-1.5">
            {unsent && <Link href={`/social/${post.id}/edit`} className="btn sm"><Pencil className="w-3.5 h-3.5" /> Edit</Link>}
            {canRetry && (
              <form action={publishNowAction}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="back" value={here} />
                <SubmitButton className="btn sm" pendingText="Sending…" title="Send again to the networks that failed — the ones that posted are left alone">
                  <RotateCw className="w-3.5 h-3.5" /> Retry failed
                </SubmitButton>
              </form>
            )}
            <form action={duplicateSocialPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="back" value="/social/drafts" />
              <SubmitButton className="btn sm" pendingText="…" title="A new draft with the same text, images and networks"><Copy className="w-3.5 h-3.5" /> Duplicate</SubmitButton>
            </form>
            {DELETABLE_POST_STATUSES.includes(post.status) && <DeleteButton kind="socialPost" id={post.id} name={name} returnTo="/social/sent" />}
          </div>
        )}
      </div>

      {(ok || err) && (
        <div className="card mb-3 text-sm" style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", color: ok ? "var(--green-on)" : "var(--rose-on)" }}>
          {ok ?? err}
        </div>
      )}
      {canRetry && unsure.length > 0 && (
        <div className="card mb-3 text-xs" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          We never heard back from {unsure.join(", ")} — {unsure.length === 1 ? "it" : "they"} may have posted. Check {unsure.length === 1 ? "that network" : "those networks"} before you retry, or it may go out twice.
        </div>
      )}

      <div className="card mb-3">
        <p className="text-sm text-[var(--slate)] whitespace-pre-wrap m-0">{post.text || <span className="text-[var(--mute)] italic">(image only)</span>}</p>
        {readJson<string[]>(post.mediaKeys, []).length > 0 && <div className="mt-2"><MediaThumbs keys={readJson<string[]>(post.mediaKeys, [])} /></div>}
        {post.firstComment && <p className="text-xs text-[var(--mute)] mt-2 mb-0">First comment: <span className="text-[var(--slate)] whitespace-pre-wrap">{post.firstComment}</span></p>}
      </div>

      <h2 className="font-mono font-bold text-sm mb-2">Per network</h2>
      {post.targets.length === 0 ? (
        <p className="text-xs text-[var(--mute)]">This post has no networks.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {post.targets.map((t) => {
            const net = networkFor(t.provider);
            const ts = STATUS_STYLE[t.status] ?? { bg: "var(--panel)", fg: "var(--mute)", label: t.status };
            const sub = subFormatLabel(t.provider, t.subFormat);
            const media = readJson<string[]>(t.mediaKeys, []);
            return (
              <div key={t.id} className="card text-xs border-l-4" style={{ borderLeftColor: net?.color ?? "var(--line-2)" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <b>{net?.label ?? t.provider}</b>
                  {sub && <span className="text-[var(--mute)]">· {sub}</span>}
                  {t.accountName && <span className="text-[var(--mute)]">· {t.accountName}</span>}
                  <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: ts.bg, color: ts.fg }}>{t.status === "pending" ? "not sent" : ts.label}</span>
                  {t.postedAt && <span className="font-mono text-[10px] text-[var(--mute)]">{formatInZone(t.postedAt, tz)}</span>}
                  <span className="flex-1" />
                  {t.platformPostUrl && (
                    <a href={t.platformPostUrl} target="_blank" rel="noreferrer" className="btn sm"><ExternalLink className="w-3 h-3" /> View on {net?.label ?? t.provider}</a>
                  )}
                </div>
                {t.error && (
                  <p className="m-0 mt-1.5" style={{ color: t.status === "failed" ? "var(--rose-on)" : "var(--mute)" }}>
                    {t.error}
                    {t.status === "failed" && mayHavePosted(t.error) && " — this one may have posted anyway; check the network before retrying."}
                  </p>
                )}
                {t.text && <p className="m-0 mt-1.5 text-[var(--slate)] whitespace-pre-wrap"><span className="text-[var(--mute)]">Own text: </span>{t.text}</p>}
                {t.firstComment && <p className="m-0 mt-1.5 text-[var(--slate)] whitespace-pre-wrap"><span className="text-[var(--mute)]">First comment: </span>{t.firstComment}</p>}
                {media.length > 0 && <div className="mt-1.5"><MediaThumbs keys={media} size="h-12 w-12" /></div>}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
