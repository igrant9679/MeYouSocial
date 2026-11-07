import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { IdeaFacts, IdeaHistory, IdeaPriority } from "@/components/IdeaDetail";
import { ideaHistory, SOURCE_LABEL } from "@/lib/idea-history";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { REJECT_REASONS, isRejectReason } from "@/lib/reject-reasons";
import { setSocialIdeaStatusAction, updateSocialIdeaAction } from "@/app/actions/social-ideas";

// One social idea's page (E-IDE-16): what it is, where it came from — an
// article's angle, a piece of research, a feed item — its priority, the post
// it became, and its history; editors can edit it and move it here. Social
// ideas had no page: everything lived on a board card.

export default async function SocialIdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const idea = await db.socialIdea.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      topic: { select: { name: true } },
      sourceBlogPost: { select: { id: true, title: true } },
      sourceVideo: { select: { id: true, title: true } },
      socialPost: { select: { id: true, status: true, scheduledAt: true, publishedAt: true } },
    },
  });
  if (!idea) notFound();
  const [history, tz] = await Promise.all([ideaHistory(workspace.id, "social_idea", idea.id), getPostingTimeZone(workspace.id)]);
  const live = idea.status !== "drafted";
  const field = "w-full mt-0.5 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs";
  const post = idea.socialPost;
  const from = idea.sourceBlogPost ? <> — <Link href={`/blog/${idea.sourceBlogPost.id}`} className="underline">{idea.sourceBlogPost.title}</Link></>
    : idea.sourceVideo ? <> — <Link href={`/intel/videos/${idea.sourceVideo.id}`} className="underline">{idea.sourceVideo.title}</Link></>
    : idea.sourceUrl ? <> — <a href={idea.sourceUrl} target="_blank" rel="noreferrer" className="underline">{(() => { try { return new URL(idea.sourceUrl).hostname.replace(/^www\./, ""); } catch { return "the link"; } })()}</a></>
    : null;
  const move = (status: string, label: string, title?: string) => (
    <form action={setSocialIdeaStatusAction}>
      <input type="hidden" name="id" value={idea.id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className="btn sm" pendingText="…" title={title}>{label}</SubmitButton>
    </form>
  );

  return (
    <div className="max-w-2xl">
      <Link href="/ideas?format=social" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Ideas board</Link>
      <h1 className="font-mono text-xl font-bold m-0 mb-1">{idea.hook}</h1>
      <p className="text-xs text-[var(--mute)] mb-4">Social idea · {idea.status}</p>

      <IdeaFacts facts={[
        { label: "Status", value: <>{idea.status}{idea.status === "rejected" && isRejectReason(idea.rejectReason) ? ` — ${REJECT_REASONS[idea.rejectReason]}` : ""}</> },
        { label: "Came from", value: <>{SOURCE_LABEL[idea.source] ?? idea.source}{from}</> },
        { label: "Topic", value: idea.topic?.name ?? <span className="text-[var(--mute)]">none</span> },
        ...(idea.angle ? [{ label: "Angle", value: idea.angle }] : []),
        ...(idea.approvedAt ? [{ label: "Approved", value: formatInZone(idea.approvedAt, tz) }] : []),
        ...(post ? [{
          label: "Post",
          value: <><Link href={`/social/${post.id}`} className="underline">open it</Link> <span className="text-[var(--mute)]">· {post.status}{post.publishedAt ? ` ${formatInZone(post.publishedAt, tz)}` : post.scheduledAt ? ` for ${formatInZone(post.scheduledAt, tz)}` : ""}</span></>,
        }] : []),
      ]} />
      <IdeaPriority score={idea.priority} reasons={null} />
      <IdeaHistory rows={history} createdAt={idea.createdAt} created={SOURCE_LABEL[idea.source] ?? idea.source} timeZone={tz} />

      {editor && live && (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-2" data-social-idea-moves>
            {idea.status !== "approved" && move("approved", idea.status === "rejected" ? "Restore" : "Approve")}
            {idea.status !== "rejected" && move("rejected", "Reject")}
            {idea.status === "approved" && move("discovered", "Not yet", "Back to Discovered — not rejected, and it won't be drafted until approved again")}
          </div>
          <form action={updateSocialIdeaAction} className="card flex flex-col gap-2" data-social-idea-edit>
            <h2 className="font-mono font-bold text-sm m-0">Edit</h2>
            <input type="hidden" name="id" value={idea.id} />
            <label className="text-2xs text-[var(--mute)]">The post in one line<textarea name="hook" defaultValue={idea.hook} rows={2} maxLength={240} className={field} /></label>
            <label className="text-2xs text-[var(--mute)]">Why it works<input name="angle" defaultValue={idea.angle ?? ""} className={field} /></label>
            <div><SubmitButton className="btn sm">Save</SubmitButton></div>
          </form>
        </>
      )}
      {editor && !live && <div className="card text-sm">This idea became a post; edit the post instead.</div>}
    </div>
  );
}
