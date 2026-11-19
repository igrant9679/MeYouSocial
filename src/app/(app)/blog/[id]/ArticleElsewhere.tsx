import Link from "next/link";
import { ArrowLeft, Repeat } from "lucide-react";
import { openArticleInWorkspaceAction } from "@/app/actions/workspace-switch";
import { SubmitButton } from "@/components/SubmitButton";
import type { ElsewhereArticle } from "@/lib/record-elsewhere";

/**
 * Shown instead of "not found" when an article's id belongs to another of this
 * person's workspaces (2026-11-19, the owner's 404 on an LSI draft). Nothing is
 * switched until they press the button; the action checks the membership and the
 * article again.
 */
export function ArticleElsewhere({ article, articleId, current, tab }: { article: ElsewhereArticle; articleId: string; current: string; tab?: string }) {
  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All posts
      </Link>
      <div className="card max-w-xl flex flex-col gap-3" data-article-elsewhere={article.workspaceId}>
        <h1 className="font-mono font-bold text-xl m-0">This article is in another workspace</h1>
        <p className="text-sm m-0">
          <b>“{article.title || "Untitled article"}”</b> belongs to <b>{article.workspaceName}</b>. You are in <b>{current}</b> now, so it can&apos;t open here.
        </p>
        <p className="text-xs text-[var(--mute)] m-0">
          This usually happens when the workspace was switched in another tab and this page was reloaded, or when the link came from {article.workspaceName} (an email, a notification, an old tab).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={openArticleInWorkspaceAction}>
            <input type="hidden" name="workspaceId" value={article.workspaceId} />
            <input type="hidden" name="articleId" value={articleId} />
            {tab ? <input type="hidden" name="tab" value={tab} /> : null}
            <SubmitButton className="btn primary sm inline-flex items-center gap-1.5" pendingText="Switching…">
              <Repeat className="w-3.5 h-3.5" /> Switch to {article.workspaceName} and open it
            </SubmitButton>
          </form>
          <Link href="/blog" className="btn sm">Stay in {current}</Link>
        </div>
      </div>
    </main>
  );
}
