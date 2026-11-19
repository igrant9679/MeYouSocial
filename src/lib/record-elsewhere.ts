import { db } from "@/lib/db";

/**
 * An article that isn't in the active workspace but is in another one this
 * person is an active member of (2026-11-19, the owner's 404 on an LSI draft).
 *
 * Every record page looks its id up in the ACTIVE workspace only, so a link
 * carried across a switch — a tab reloaded after switching in another tab (the
 * WorkspaceGuard's "Reload"), an email, a copied address — used to land on a bare
 * "not found". The article page now names the workspace that has it and offers to
 * switch. Only the person's own active memberships are searched: a workspace they
 * aren't in, a pending invitation or a deleted workspace stays "not found", so
 * nothing about another tenant is revealed.
 */
export type ElsewhereArticle = { workspaceId: string; workspaceName: string; title: string };

type MemberLike = { workspaceId: string; status: string; workspace: { name: string } };

export async function articleElsewhere(
  memberships: MemberLike[],
  activeWorkspaceId: string,
  articleId: string,
): Promise<ElsewhereArticle | null> {
  const others = memberships.filter((m) => m.status === "active" && m.workspaceId !== activeWorkspaceId);
  if (others.length === 0 || !articleId) return null;
  const found = await db.blogPost.findFirst({
    where: { id: articleId, workspaceId: { in: others.map((m) => m.workspaceId) } },
    select: { workspaceId: true, title: true },
  });
  if (!found) return null;
  const ws = others.find((m) => m.workspaceId === found.workspaceId);
  if (!ws) return null;
  return { workspaceId: found.workspaceId, workspaceName: ws.workspace.name, title: found.title };
}
