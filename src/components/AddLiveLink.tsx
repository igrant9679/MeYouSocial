import { Link2 } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { addLiveLinkAction } from "@/app/actions/blog-export";

/**
 * "Add live link" (2026-11-23): saves the web address of a published article
 * that has none in Publisher. Shown to admins only, on the article's page and
 * its row under Articles → Recently published; the rules are in
 * `addLiveLinkAction`. `back` says where the answer is shown.
 */
export function AddLiveLink({ postId, back, className = "" }: { postId: string; back: "editor" | "publish"; className?: string }) {
  return (
    <form action={addLiveLinkAction} className={`flex items-center gap-1.5 flex-wrap ${className}`} data-add-live-link={postId}>
      <input type="hidden" name="id" value={postId} />
      {back === "editor" && <input type="hidden" name="back" value="editor" />}
      <Link2 className="w-3.5 h-3.5 shrink-0 text-[var(--mute)]" aria-hidden />
      <input
        name="url"
        type="url"
        required
        inputMode="url"
        placeholder="https://… the page where it's live"
        className="text-xs min-w-56 flex-1"
        aria-label="Live link"
      />
      <SubmitButton className="btn sm primary" pendingText="Saving…" title="Save where this article is live — the composer's Add link offers it, and analytics matches it">
        Add live link
      </SubmitButton>
    </form>
  );
}
