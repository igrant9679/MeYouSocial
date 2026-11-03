import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { runTurn } from "@/lib/assistant/session";
import { getActiveChannel } from "@/lib/channel";
import type { AssistantStep } from "@/lib/assistant/run";
import { publicSteps } from "@/lib/assistant/undo";

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
    messages: thread.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, steps: publicSteps(readJson<AssistantStep[]>(m.steps, [])), tokens: m.inputTokens != null || m.outputTokens != null ? (m.inputTokens ?? 0) + (m.outputTokens ?? 0) : null })),
  });
}

export async function POST(req: Request) {
  const c = await caller();
  const { workspace, user, membership } = c.ctx;
  const body = (await req.json().catch(() => ({}))) as { threadId?: string; message?: string; page?: string; confirm?: string; stream?: boolean };
  const message = String(body.message ?? "").trim();
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });
  const { active } = await getActiveChannel();
  const input = {
    workspaceId: workspace.id,
    userId: user.id,
    role: membership.role,
    threadId: body.threadId ?? null,
    message,
    page: typeof body.page === "string" && body.page.startsWith("/") ? body.page.slice(0, 200) : null,
    channelId: active?.id ?? null,
    confirm: typeof body.confirm === "string" && body.confirm ? body.confirm.slice(0, 40) : null,
  };

  // E-ENG-12: the dock asks for a stream — one JSON line per event: the
  // thread, each step as it starts and ends, then the reply. A thread that
  // isn't this person's is a 404 before anything streams, as before.
  if (body.stream) {
    if (input.threadId && !(await db.assistantThread.count({ where: { id: input.threadId, workspaceId: workspace.id, userId: user.id } }))) {
      return Response.json({ error: "no thread" }, { status: 404 });
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* the reader went away; the turn still finishes */ } };
        try {
          const out = await runTurn({ ...input, live: { onThread: (threadId) => send({ type: "thread", threadId }), onProgress: (e) => send({ type: "progress", ...e }) } });
          send(out ? { type: "reply", ...replyJson(out) } : { type: "error", error: "no thread" });
        } catch (e) {
          send({ type: "error", error: e instanceof Error ? e.message.slice(0, 200) : "the turn failed" });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }

  const out = await runTurn(input);
  if (!out) return Response.json({ error: "no thread" }, { status: 404 });
  return Response.json(replyJson(out));
}

/** The reply as the dock reads it — the same shape streamed or not. */
function replyJson(out: NonNullable<Awaited<ReturnType<typeof runTurn>>>) {
  const r = out.result;
  return {
    threadId: out.threadId,
    messageId: out.messageId,
    answer: r.error && !r.answer ? r.error : r.answer,
    // An undo's snapshots stay on the server (E-ENG-09).
    steps: publicSteps(r.steps),
    options: r.options ?? [],
    links: r.links ?? [],
    pending: r.pending ?? null,
    error: r.error ?? null,
    usage: r.usage?.calls ? r.usage : null,
  };
}
