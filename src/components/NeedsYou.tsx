import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { networkFor } from "@/lib/social/networks";
import type { InboxData } from "@/lib/inbox";
import { approveSocialPostAction, requestChangesSocialPostAction } from "@/app/actions/social-workflow";
import { answerFindingAction, dismissFindingAction } from "@/app/actions/blog-findings";
import { deleteCitationAction, overrideGateAction, verifyCitationAction } from "@/app/actions/blog";
import { approveBlogImageAction } from "@/app/actions/blog-images";

/**
 * The item cards of "Needs you" — one card per thing waiting on a person,
 * the action on the card. Shared by the Inbox (everything) and the Review
 * stage (the review-stage subset), so the two never drift.
 */

export function Group({ title, hue, count, children }: { title: string; hue: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono font-bold text-sm m-0">{title}</h2>
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>{count}</span>
      </div>
      <ul className="m-0 p-0 flex flex-col gap-2">{children}</ul>
    </section>
  );
}

export function NeedsYouGroups({
  inbox,
  admin,
  editor,
  timeZone,
  origin,
  include = ["posts", "questions", "citations", "images", "articles", "invitations"],
}: {
  inbox: InboxData;
  admin: boolean;
  editor: boolean;
  timeZone: string;
  origin: string;
  include?: Array<"posts" | "questions" | "citations" | "images" | "articles" | "invitations">;
}) {
  const on = (k: (typeof include)[number]) => include.includes(k);
  return (
    <>
      {on("posts") && inbox.socialPosts.length > 0 && (
        <Group title="Posts waiting for approval" hue="violet" count={inbox.socialPosts.length}>
          {inbox.socialPosts.map((p) => (
            <li key={p.id} className="card flex flex-col gap-2">
              <p className="text-sm m-0 whitespace-pre-wrap leading-relaxed">{p.text.length > 320 ? `${p.text.slice(0, 320)}…` : p.text}</p>
              <div className="text-[11px] text-[var(--mute)] flex items-center gap-2 flex-wrap">
                <span>{p.providers.length ? p.providers.map((x) => networkFor(x)?.label ?? x).join(" · ") : "no network chosen yet"}</span>
                {p.submittedBy && <span>· by {p.submittedBy}</span>}
                {p.scheduledAt
                  ? <span>· asked for {p.scheduledAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}</span>
                  : <span>· takes the next free slot when approved</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {admin ? (
                  <>
                    <form action={approveSocialPostAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton className="btn primary sm" pendingText="Approving…">Approve</SubmitButton>
                    </form>
                    <form action={requestChangesSocialPostAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="note" placeholder="what to change (optional)" className="text-[11px] w-44" aria-label="Note for the author" />
                      <SubmitButton className="btn sm" pendingText="…">Request changes</SubmitButton>
                    </form>
                  </>
                ) : (
                  <span className="text-[11px] text-[var(--mute)]">An admin approves this.</span>
                )}
                <span className="flex-1" />
                <Link href={`/social/${p.id}/edit`} className="btn sm">Open</Link>
              </div>
            </li>
          ))}
        </Group>
      )}

      {on("questions") && inbox.questions.length > 0 && (
        <Group title="Questions only you can answer" hue="amber" count={inbox.questions.length}>
          {inbox.questions.map((q) => (
            <li key={q.findingId} className="card">
              <div className="text-[11px] text-[var(--mute)] mb-1">
                For <Link href={`/blog/${q.postId}?tab=optimize`} className="underline">{q.postTitle}</Link>
              </div>
              <div className="text-sm font-semibold leading-snug">{q.title}</div>
              {q.detail && <p className="text-xs text-[var(--mute)] mt-0.5 mb-0">{q.detail}</p>}
              {editor ? (
                <form action={answerFindingAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="id" value={q.findingId} />
                  {q.questions.map((qq, i) => (
                    <label key={i} className="text-xs flex flex-col gap-1">
                      <span>{qq.q}</span>
                      <textarea name={`a${i}`} rows={2} className="w-full text-sm" placeholder="In your own words — only what you can stand behind if quoted." />
                    </label>
                  ))}
                  <div className="flex items-center gap-2 flex-wrap">
                    <SubmitButton className="btn primary sm" pendingText="Saving and writing…">Answer</SubmitButton>
                    <span className="text-[10px] text-[var(--mute)]">Saved to the Experts profile — asked once.</span>
                    <span className="flex-1" />
                    <form action={dismissFindingAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={q.findingId} />
                      <input name="reason" placeholder="why? (optional)" className="text-[11px] w-32" aria-label="Reason for dismissing" />
                      <SubmitButton className="btn sm" pendingText="…">Dismiss</SubmitButton>
                    </form>
                  </div>
                </form>
              ) : (
                <p className="text-[11px] text-[var(--mute)] mt-1 mb-0">An editor answers this.</p>
              )}
            </li>
          ))}
        </Group>
      )}

      {on("citations") && inbox.citations.length > 0 && (
        <Group title="Claims with no source" hue="rose" count={inbox.citations.length}>
          {inbox.citations.map((c) => (
            <li key={c.id} className="card">
              <div className="text-[11px] text-[var(--mute)] mb-1">
                In <Link href={`/blog/${c.postId}`} className="underline">{c.postTitle}</Link>
                {c.unsourceable && <span> · live search found nothing that supports it</span>}
              </div>
              <p className="text-sm m-0 leading-relaxed">“{c.claim}”</p>
              {editor && (
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <form action={verifyCitationAction} className="flex items-center gap-1.5 flex-wrap">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="sourceUrl" type="url" required placeholder="https://… a source that actually supports it" className="text-xs min-w-72 flex-1" aria-label="Source URL" />
                    <SubmitButton className="btn primary sm" pendingText="Verifying…">Verify</SubmitButton>
                  </form>
                  <form action={deleteCitationAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton className="btn sm" pendingText="…" title="Removes the [NEEDS SOURCE] marker and its record, so the sentence stands unsourced — edit it in the editor if it should go too">Drop the claim</SubmitButton>
                  </form>
                  <Link href={`/blog/${c.postId}`} className="btn sm">Open</Link>
                </div>
              )}
            </li>
          ))}
        </Group>
      )}

      {on("images") && inbox.images.length > 0 && (
        <Group title="Images that need your eye" hue="blue" count={inbox.images.length}>
          {inbox.images.map((img) => (
            <li key={img.id} className="card flex items-start gap-3 flex-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.altText ?? ""} className="w-40 h-24 rounded-lg object-cover border border-[var(--line)] shrink-0" />
              <div className="flex-1 min-w-48">
                <div className="text-[11px] text-[var(--mute)]">
                  {img.role === "og" ? "Open Graph image" : "Featured image"} for <Link href={`/blog/${img.postId}`} className="underline">{img.postTitle}</Link>
                </div>
                <div className="text-xs mt-0.5">
                  {img.rejections >= 2
                    ? "Auto-review rejected this render and the ones before it, and stopped spending on new ones — it waits for you."
                    : "Waiting for a person to approve it."}
                </div>
                {editor && (
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <form action={approveBlogImageAction}>
                      <input type="hidden" name="id" value={img.id} />
                      <SubmitButton className="btn primary sm" pendingText="…">Approve</SubmitButton>
                    </form>
                    <Link href={`/blog/${img.postId}`} className="btn sm">Pick or upload instead</Link>
                  </div>
                )}
              </div>
            </li>
          ))}
        </Group>
      )}

      {on("articles") && inbox.articles.length > 0 && (
        <Group title="Articles held at review" hue="rose" count={inbox.articles.length}>
          {inbox.articles.map((a) => (
            <li key={a.id} className="card flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-56">
                <Link href={`/blog/${a.id}`} className="text-sm font-semibold hover:underline">{a.title}</Link>
                <div className="text-xs text-[var(--mute)] mt-0.5">
                  {a.failing.length === 0
                    ? "Every required check passes — it advances on the next cycle."
                    : `Held by: ${a.failing.join(" · ")}`}
                  {a.openQuestions > 0 && <span> · {a.openQuestions} question{a.openQuestions === 1 ? "" : "s"} above</span>}
                </div>
              </div>
              <Link href={`/blog/${a.id}`} className="btn sm">Open</Link>
              {/* The owner's override (2026-09-08): a person outranks the checks.
                  Recorded with name and reason; carries through the sweep and
                  publishing, so the article does not stall a step later. */}
              {admin && a.failing.length > 0 && (
                <form action={overrideGateAction} className="basis-full flex items-center gap-1.5 flex-wrap pt-1">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="reason" placeholder="why you're overriding (optional)" className="text-[11px] min-w-56 flex-1" aria-label="Reason for overriding the checks" />
                  <SubmitButton className="btn sm primary" pendingText="Advancing…" title="Override the checks named above and move the article to final approval now — recorded with your name and reason">Advance anyway</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </Group>
      )}

      {on("invitations") && inbox.invitations.length > 0 && (
        <Group title="Invitations not yet accepted" hue="teal" count={inbox.invitations.length}>
          {inbox.invitations.map((i) => (
            <li key={i.id} className="card">
              <div className="text-sm"><b>{i.email}</b> <span className="font-mono text-[10px] text-[var(--mute)]">{i.role}</span> <span className="text-[11px] text-[var(--mute)]">· expires {i.expiresAt.toLocaleDateString()}</span></div>
              <div className="text-[11px] text-[var(--mute)] mt-1">If the email didn&apos;t arrive, send this link yourself (click to select):</div>
              <code className="block text-[11px] select-all break-all mt-0.5">{origin}/invitations/{i.token}</code>
            </li>
          ))}
        </Group>
      )}
    </>
  );
}
