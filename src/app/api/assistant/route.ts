import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { runTurn } from "@/lib/assistant/session";
import { getActiveChannel } from "@/lib/channel";
import type { AssistantStep } from "@/lib/assistant/run";

/**
 * The assistant dock's API — the same turn the full page runs, as JSON, so
 * the dock can sit on every page. GET returns a thread's messages; POST runs
 * a turn. Any member: a viewer's turn runs with read tools only (E-ENG-15 —
 * `toolAllowedFor` in lib/assistant/tools.ts, enforced where tools are
 * offered, proposed and run), so it can explain but never change anything.
 */

/** The caller. Never `requireRole` here: it redirects, and the dock would parse the /forbidden page as JSON (ENG-17). */
async function caller() {
  const ctx = await requireMembership();
  return { ctx } as const;
}

export async function GET(req: Request) {
  const c = await caller();
  const { workspace, user } = c.ctx;
  const threadId = new URL(req.url).searchParams.get("threadId") ?? "";
  if (!threadId) {
    const threads = await db.assistantThread.findMany({ where: { workspaceId: workspace.id, userId: user.id }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, updatedAt: true } });
    return Response.json({ threads });
  }
  const thread = await db.assistantThread.findFirst({ where: { id: threadId, workspaceId: workspace.id, userId: user.id }, include: { messages: { orderBy: { createdAt: "desc" }, take: 60 } } });
  if (!thread) return Response.json({ error: "not found" }, { status: 404 });
  // The latest sixty, oldest first — the dock reload used to drop the newest.
  thread.messages.reverse();
  return Response.json({
    threadId: thread.id,
    title: thread.title,
    // The dock starts afresh after a long idle (E-ENG-11) — it reads this.
    updatedAt: thread.updatedAt.toISOString(),
    pending: thread.pending ? readJson(thread.pending, null) : null,
    messages: thread.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, steps: readJson<AssistantStep[]>(m.steps, []), tokens: m.inputTokens != null || m.outputTokens != null ? (m.inputTokens ?? 0) + (m.outputTokens ?? 0) : null })),
  });
}

export async function POST(req: Request) {
  const c = await caller();
  const { workspace, user, membership } = c.ctx;
  const body = (await req.json().catch(() => ({}))) as { threadId?: string; message?: string; page?: string; confirm?: string };
  const message = String(body.message ?? "").trim();
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });
  const { active } = await getActiveChannel();
  const out = await runTurn({
    workspaceId: workspace.id,
    userId: user.id,
    role: membership.role,
    threadId: body.threadId ?? null,
    message,
    page: typeof body.page === "string" && body.page.startsWith("/") ? body.page.slice(0, 200) : null,
    channelId: active?.id ?? null,
    confirm: typeof body.confirm === "string" && body.confirm ? body.confirm.slice(0, 40) : null,
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
    usage: r.usage?.calls ? r.usage : null,
  });
}
