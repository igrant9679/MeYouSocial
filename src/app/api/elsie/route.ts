import { requireMembership } from "@/lib/acl";
import { dismissElsieSuggestion, elsieSuggestions, restoreElsieSuggestions } from "@/lib/elsie/suggestions";

/**
 * Elsie's suggestions for the page her pane sits beside (lib/elsie/suggestions.ts).
 * GET ?page=/ideas lists them; POST {dismiss: key} hides one for this person,
 * POST {restore: true} brings theirs back. No model is called here.
 *
 * `requireMembership`, as the assistant's API does: a signed-out pane gets the
 * sign-in page, which it recognises as not-JSON and ignores.
 */

export const dynamic = "force-dynamic";

const pageOf = (raw: string | null | undefined): string | null =>
  typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw.slice(0, 200) : null;

export async function GET(req: Request) {
  const { workspace, user, membership } = await requireMembership();
  const page = pageOf(new URL(req.url).searchParams.get("page"));
  const out = await elsieSuggestions({ workspaceId: workspace.id, userId: user.id, role: membership.role, page });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const { workspace, user, membership } = await requireMembership();
  // A viewer is shown no suggestions, so has none to dismiss.
  if (membership.role === "VIEWER") return Response.json({ error: "viewers have no suggestions to change" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { dismiss?: unknown; restore?: unknown; page?: unknown };
  if (body.restore === true) {
    await restoreElsieSuggestions(workspace.id, user.id);
  } else if (typeof body.dismiss === "string") {
    if (!(await dismissElsieSuggestion(workspace.id, user.id, body.dismiss))) return Response.json({ error: "not a suggestion" }, { status: 400 });
  } else {
    return Response.json({ error: "nothing to do" }, { status: 400 });
  }
  const page = pageOf(typeof body.page === "string" ? body.page : null);
  const out = await elsieSuggestions({ workspaceId: workspace.id, userId: user.id, role: membership.role, page });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
