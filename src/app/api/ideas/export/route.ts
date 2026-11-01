import { db } from "@/lib/db";
import { getCurrentUser, activeWorkspaceIdFor } from "@/lib/acl";
import { toCsv } from "@/lib/csv";

/**
 * Ideas and keywords as CSV (E-IDE-24): ?kind=articles | social | keywords,
 * for the active workspace, with Topic, status and priority. Any member may
 * read them — they're on the board already.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const workspaceId = await activeWorkspaceIdFor(user.id);
  if (!workspaceId) return Response.json({ error: "You aren't a member of a workspace." }, { status: 403 });
  const kind = new URL(req.url).searchParams.get("kind") ?? "articles";

  let csv: string;
  if (kind === "keywords") {
    const rows = await db.keyword.findMany({ where: { workspaceId }, orderBy: [{ tier: "asc" }, { phrase: "asc" }], take: 5000 });
    csv = toCsv(["phrase", "tier", "intent", "cluster", "status", "volume", "notes"], rows.map((k) => [k.phrase, k.tier, k.intent, k.cluster, k.status, k.volume, k.notes]));
  } else if (kind === "social") {
    const rows = await db.socialIdea.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 5000, include: { topic: { select: { name: true } } } });
    csv = toCsv(["hook", "angle", "topic", "status", "priority", "source", "created"], rows.map((i) => [i.hook, i.angle, i.topic?.name, i.status, i.priority, i.source, i.createdAt]));
  } else {
    const rows = await db.blogIdea.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 5000, include: { topic: { select: { name: true } } } });
    csv = toCsv(["title", "angle", "keyword", "topic", "status", "priority", "source", "created"], rows.map((i) => [i.title, i.angle, i.keyword, i.topic?.name, i.status, i.priority, i.source, i.createdAt]));
  }
  const name = kind === "keywords" ? "keywords" : kind === "social" ? "social-ideas" : "article-ideas";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
