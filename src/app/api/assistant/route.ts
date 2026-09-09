import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { runTurn } from "@/lib/assistant/session";
import type { AssistantStep } from "@/lib/assistant/run";

/**
 * The assistant dock's API — the same turn the full page runs, as JSON, so
 * the dock can sit on every page. GET returns a thread's messages; POST runs
 * a turn. EDITOR and up, like the page.
 */

export async function GET(req: Request) {
  const { workspace, user } = await requireRole("EDITOR");
  const threadId = new URL(req.url).searchParams.get("threadId") ?? "";
  if (!threadId) {
    const threads = await db.assistantThread.findMany({ where: { workspaceId: workspace.id, userId: user.id }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, updatedAt: true } });
    return Response.json({ threads });
  }
  const thread = await db.assistantThread.findFirst({ where: { id: threadId, workspaceId: workspace.id, userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 60 } } });
  if (!thread) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    threadId: thread.id,
    title: thread.title,
    pending: thread.pending ? readJson(thread.pending, null) : null,
    messages: thread.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, steps: readJson<AssistantStep[]>(m.steps, []) })),
  });
}

export async function POST(req: Request) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const body = (await req.json().catch(() => ({}))) as { threadId?: string; message?: string; page?: string };
  const message = String(body.message ?? "").trim();
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });
  const out = await runTurn({
    workspaceId: workspace.id,
    userId: user.id,
    role: membership.role,
    threadId: body.threadId ?? null,
    message,
    page: typeof body.page === "string" && body.page.startsWith("/") ? body.page.slice(0, 200) : null,
  });
  if (!out) return Response.json({ error: "no thread" }, { status: 404 });
  const r = out.result;
  return Response.json({
    threadId: out.threadId,
    answer: r.error && !r.answer ? r.error : r.answer,
    steps: r.steps,
    options: r.options ?? [],
    links: r.links ?? [],
    pending: r.pending ?? null,
    error: r.error ?? null,
  });
}
