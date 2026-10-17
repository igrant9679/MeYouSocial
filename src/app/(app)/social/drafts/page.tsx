import { requireMembership, canEdit } from "@/lib/acl";
import { PostList, listFilterFrom } from "@/components/PostList";

// Distribute → Drafts (Socialmonials parity, 2026-10-17). The list itself lives
// in components/PostList.tsx so Queue, Sent and Drafts never drift apart.
export default async function SocialDraftsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, membership } = await requireMembership();
  const sp = await searchParams;
  return (
    <PostList
      tab="drafts"
      workspaceId={workspace.id}
      editor={canEdit(membership.role)}
      filter={listFilterFrom(sp)}
      flash={{ ok: sp.ok, err: sp.err }}
    />
  );
}
