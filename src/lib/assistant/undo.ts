import { db } from "@/lib/db";

/**
 * Undo for the assistant's writes (E-ENG-09).
 *
 * A tool with an UNDOER is read before it runs and again after: the two
 * snapshots go onto the stored step (server-side only — `publicSteps` strips
 * them before anything reaches a browser). For UNDO_WINDOW_MS the person who
 * asked can press Undo; the undo first reads the thing AGAIN and refuses if it
 * no longer matches the after-snapshot — someone or something changed it
 * since, and undoing over that would wipe their change. Then it writes the
 * before-snapshot back.
 *
 * What can't be undone here isn't pretended: a publish, a send, an invitation
 * that has gone out, full autonomy (it changes several dials at once — turn it
 * back with the opposite request), and the approval dial (its own action
 * writes it) carry no undoer, so no Undo button.
 */

export const UNDO_WINDOW_MS = 10 * 60_000;

type Args = Record<string, unknown>;
type Ctx = { workspaceId: string; userId: string; role: string };
type Snap = Record<string, unknown> | null;

export type Undoer = {
  /** Shown on the button: what pressing it does. */
  label: (args: Args) => string;
  /** The state this tool touches. `output` is null before the run; after it, the tool's reply (for ids it created). */
  read: (args: Args, ctx: Ctx, output: string | null) => Promise<Snap>;
  /** Put `before` back (only called once `read` matches `after` again). Returns what happened. */
  write: (before: Snap, after: Snap, ctx: Ctx, args: Args) => Promise<string>;
};

/** What a step keeps so it can be undone. `state` never leaves the server. */
export type StepUndo = { label: string; until: string; done?: string | null; state?: { before: Snap; after: Snap } };

export class UndoRefused extends Error {}

const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function rawSetting(workspaceId: string, key: string): Promise<string> {
  return (await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key } }, select: { value: true } }))?.value ?? "";
}

/** A dial: its stored value before, written back with the app's own setter (so dial history records it). */
function settingUndoer(keyOf: (a: Args) => string | null, label: string): Undoer {
  return {
    label: () => label,
    async read(a, ctx) {
      const key = keyOf(a);
      return key ? { key, value: await rawSetting(ctx.workspaceId, key) } : null;
    },
    async write(before, _after, ctx) {
      const { setWorkspaceSetting } = await import("@/lib/settings");
      await setWorkspaceSetting(ctx.workspaceId, String(before!.key), String(before!.value ?? ""));
      return before!.value ? `${before!.key} is back to ${before!.value}` : `${before!.key} is back to its default`;
    },
  };
}

const SOCIAL_DIALS: Record<string, string> = { autoqueue: "social:autoqueue", evergreen_fill: "social:evergreen_fill", auto_image: "social:auto_image", autogen: "social:autogen", autogen_weekly: "social:autogen_weekly" };

/** An idea's decision: its status (and why it was rejected, when it was approved) before. */
const ideaDecision: Undoer = {
  label: () => "Put the idea back as it was",
  async read(a, ctx) {
    const id = s(a.ideaId, 40);
    if (s(a.format, 10) === "social") {
      const i = await db.socialIdea.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { status: true, rejectReason: true, approvedAt: true } });
      return i ? { format: "social", id, status: i.status, rejectReason: i.rejectReason, approvedAt: i.approvedAt?.toISOString() ?? null } : null;
    }
    const i = await db.blogIdea.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { status: true, rejectReason: true } });
    return i ? { format: "article", id, status: i.status, rejectReason: i.rejectReason } : null;
  },
  async write(before, _after, ctx) {
    const b = before!;
    if (b.format === "social") {
      await db.socialIdea.updateMany({ where: { id: String(b.id), workspaceId: ctx.workspaceId }, data: { status: String(b.status), rejectReason: (b.rejectReason as string | null) ?? null, approvedAt: b.approvedAt ? new Date(String(b.approvedAt)) : null } });
    } else {
      await db.blogIdea.updateMany({ where: { id: String(b.id), workspaceId: ctx.workspaceId }, data: { status: String(b.status), rejectReason: (b.rejectReason as string | null) ?? null } });
    }
    return `the idea is ${b.status} again`;
  },
};

/** Something the tool CREATED, found by the id in its reply: undone by deleting it, if it is still as made. */
function createdUndoer(label: string, idIn: RegExp, read: (id: string, ctx: Ctx) => Promise<Snap>, remove: (id: string, ctx: Ctx) => Promise<void>, gone: string): Undoer {
  return {
    label: () => label,
    async read(_a, ctx, output) {
      if (output === null) return { id: null };
      const id = output.match(idIn)?.[1];
      return id ? read(id, ctx) : null;
    },
    async write(_before, after, ctx) {
      await remove(String(after!.id), ctx);
      return gone;
    },
  };
}

export const UNDOERS: Record<string, Undoer> = {
  approve_idea: ideaDecision,
  reject_idea: ideaDecision,
  approve_video_idea: {
    label: () => "Put the video idea back as it was",
    async read(a, ctx) {
      const i = await db.idea.findFirst({ where: { id: s(a.ideaId, 40), channel: { workspaceId: ctx.workspaceId } }, select: { id: true, status: true } });
      return i ? { id: i.id, status: i.status } : null;
    },
    async write(before, _after, ctx) {
      await db.idea.updateMany({ where: { id: String(before!.id), channel: { workspaceId: ctx.workspaceId } }, data: { status: String(before!.status) } });
      return `the video idea is ${before!.status} again`;
    },
  },
  add_idea: createdUndoer(
    "Remove the idea it added",
    /added (?:article|social|video) idea (\S+)/,
    async (id, ctx) => {
      const [a, so, v] = await Promise.all([
        db.blogIdea.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, status: true, title: true } }),
        db.socialIdea.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, status: true, hook: true } }),
        db.idea.findFirst({ where: { id, channel: { workspaceId: ctx.workspaceId } }, select: { id: true, status: true, title: true } }),
      ]);
      return a ? { id, kind: "article", status: a.status, text: a.title } : so ? { id, kind: "social", status: so.status, text: so.hook } : v ? { id, kind: "video", status: v.status, text: v.title } : null;
    },
    async (id, ctx) => {
      await db.blogIdea.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
      await db.socialIdea.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
      await db.idea.deleteMany({ where: { id, channel: { workspaceId: ctx.workspaceId } } });
    },
    "the idea it added is gone",
  ),
  add_topic: createdUndoer(
    "Remove the Topic it added",
    /topic (\S+) "/,
    async (id, ctx) => {
      const t = await db.topic.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, name: true, status: true, _count: { select: { blogIdeas: true, socialIdeas: true, channelIdeas: true, blogPosts: true, socialPosts: true } } } });
      return t ? { id, name: t.name, status: t.status, tagged: t._count.blogIdeas + t._count.socialIdeas + t._count.channelIdeas + t._count.blogPosts + t._count.socialPosts } : null;
    },
    async (id, ctx) => { await db.topic.deleteMany({ where: { id, workspaceId: ctx.workspaceId } }); },
    "the Topic it added is gone",
  ),
  draft_social_post: createdUndoer(
    "Delete the draft it wrote",
    /drafted social post (\S+)/,
    async (id, ctx) => {
      const p = await db.socialPost.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, status: true, text: true, scheduledAt: true } });
      return p ? { id, status: p.status, text: p.text, scheduledAt: p.scheduledAt?.toISOString() ?? null } : null;
    },
    async (id, ctx) => { await db.socialPost.deleteMany({ where: { id, workspaceId: ctx.workspaceId, status: "draft" } }); },
    "the draft it wrote is deleted",
  ),
  add_keyword: {
    label: () => "Put the keyword back as it was",
    async read(a, ctx) {
      const { stripListMarker } = await import("@/lib/list-marker");
      const phrase = stripListMarker(s(a.phrase, 120)).toLowerCase();
      if (!phrase) return null;
      const k = await db.keyword.findUnique({ where: { workspaceId_phrase: { workspaceId: ctx.workspaceId, phrase } }, select: { tier: true, cluster: true } });
      return { phrase, exists: !!k, tier: k?.tier ?? null, cluster: k?.cluster ?? null };
    },
    async write(before, _after, ctx) {
      const b = before!;
      if (!b.exists) {
        await db.keyword.deleteMany({ where: { workspaceId: ctx.workspaceId, phrase: String(b.phrase) } });
        return `keyword "${b.phrase}" removed`;
      }
      await db.keyword.updateMany({ where: { workspaceId: ctx.workspaceId, phrase: String(b.phrase) }, data: { tier: Number(b.tier) } });
      return `keyword "${b.phrase}" is back at tier ${b.tier}`;
    },
  },
  add_posting_slots: {
    label: () => "Remove the slots it added",
    async read(_a, ctx) {
      const rows = await db.postingSlot.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true }, orderBy: { id: "asc" } });
      return { ids: rows.map((r) => r.id) };
    },
    async write(before, after, ctx) {
      const had = new Set(before!.ids as string[]);
      const added = (after!.ids as string[]).filter((id) => !had.has(id));
      await db.postingSlot.deleteMany({ where: { workspaceId: ctx.workspaceId, id: { in: added } } });
      return `${added.length} slot${added.length === 1 ? "" : "s"} removed`;
    },
  },
  unschedule_social_post: {
    label: () => "Schedule the post again",
    async read(a, ctx) {
      const p = await db.socialPost.findFirst({ where: { id: s(a.postId, 40), workspaceId: ctx.workspaceId }, select: { id: true, status: true, scheduledAt: true } });
      return p ? { id: p.id, status: p.status, scheduledAt: p.scheduledAt?.toISOString() ?? null } : null;
    },
    async write(before, _after, ctx) {
      const at = before!.scheduledAt ? new Date(String(before!.scheduledAt)) : null;
      if (!at || at.getTime() <= Date.now()) throw new UndoRefused("its time has passed — schedule it again from the post");
      await db.socialPost.updateMany({ where: { id: String(before!.id), workspaceId: ctx.workspaceId, status: "draft" }, data: { status: "scheduled", scheduledAt: at, heldAt: null, heldById: null } });
      return "scheduled again for the time it had";
    },
  },
  set_publish_day: settingUndoer(() => "autopilot:publish_day", "Put the publish day back"),
  set_timezone: settingUndoer(() => "social:timezone", "Put the time zone back"),
  set_weekly_articles: settingUndoer(() => "autopilot:weekly_articles", "Put the weekly target back"),
  set_video_studio: settingUndoer(() => "studio:enabled", "Put the video studio back"),
  set_social_dial: settingUndoer((a) => SOCIAL_DIALS[s(a.dial, 30)] ?? null, "Put the dial back"),
  set_function_mode: {
    label: () => "Put the mode back",
    async read(a, ctx) {
      const fn = s(a.function, 30);
      const row = await db.functionMode.findUnique({ where: { workspaceId_function: { workspaceId: ctx.workspaceId, function: fn } }, select: { mode: true } });
      return { fn, mode: row?.mode ?? null };
    },
    async write(before, _after, ctx) {
      const fn = String(before!.fn);
      if (before!.mode === null) await db.functionMode.deleteMany({ where: { workspaceId: ctx.workspaceId, function: fn } });
      else await db.functionMode.update({ where: { workspaceId_function: { workspaceId: ctx.workspaceId, function: fn } }, data: { mode: String(before!.mode) } });
      return `${fn} is ${before!.mode ?? "manual (its default)"} again`;
    },
  },
  set_global_pause: {
    label: () => "Put the pause back as it was",
    async read(_a, ctx) {
      return { paused: (await db.automationState.findUnique({ where: { workspaceId: ctx.workspaceId }, select: { globalPause: true } }))?.globalPause ?? false };
    },
    async write(before, _after, ctx) {
      const paused = before!.paused === true;
      await db.automationState.upsert({ where: { workspaceId: ctx.workspaceId }, update: { globalPause: paused }, create: { workspaceId: ctx.workspaceId, globalPause: paused } });
      return paused ? "paused again" : "running again";
    },
  },
  change_role: {
    label: () => "Put their role back",
    async read(a, ctx) {
      const u = await db.user.findUnique({ where: { email: s(a.email, 200).toLowerCase() }, select: { id: true } });
      if (!u || u.id === ctx.userId) return null;
      const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId: u.id, workspaceId: ctx.workspaceId } }, select: { role: true } });
      return m ? { userId: u.id, role: m.role } : null;
    },
    async write(before, _after, ctx) {
      await db.membership.updateMany({ where: { workspaceId: ctx.workspaceId, userId: String(before!.userId) }, data: { role: before!.role as "ADMIN" | "EDITOR" | "VIEWER" } });
      return `their role is ${before!.role} again`;
    },
  },
};

/**
 * Run a tool with its undo captured: read, run, read. Returns the undo to keep
 * on the step — none when the tool has no undoer, failed, or changed nothing.
 */
export async function withUndo(name: string, args: Args, ctx: Ctx, run: () => Promise<{ ok: boolean; output: string }>, now = new Date()): Promise<{ ok: boolean; output: string; undo?: StepUndo }> {
  const u = UNDOERS[name];
  const before = u ? await u.read(args, ctx, null).catch(() => undefined) : undefined;
  const result = await run();
  if (!u || !result.ok || before === undefined) return result;
  const after = await u.read(args, ctx, result.output).catch(() => undefined);
  if (after === undefined || after === null || same(before, after)) return result;
  return { ...result, undo: { label: u.label(args), until: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(), state: { before, after } } };
}

/** Steps as a browser may see them: an undo's snapshots stay on the server. */
export function publicSteps<T>(steps: T[]): T[] {
  return steps.map((st) => {
    const u = (st as { undo?: StepUndo }).undo;
    if (!u?.state) return st;
    const { state: _s, ...rest } = u;
    return { ...st, undo: rest };
  });
}

/** The steps whose Undo is still on offer, with their index in the reply. */
export function openUndos(steps: Array<{ kind: string; undo?: StepUndo }>, now = Date.now()): Array<{ index: number; undo: StepUndo }> {
  return steps.flatMap((st, index) => (st.kind === "tool" && undoOpen(st.undo, now) ? [{ index, undo: st.undo! }] : []));
}

/** Is this step's Undo still on offer? */
export function undoOpen(u: StepUndo | undefined, now: number): boolean {
  return !!u && !u.done && Date.parse(u.until) > now;
}

/**
 * Undo one step of one of THIS person's assistant replies. Every check the
 * button implies is made here: their thread, their workspace, the window, not
 * already undone, their role still allowed the tool, and the thing exactly as
 * the tool left it. Claimed atomically (the stored steps must be unchanged),
 * so a double press undoes once.
 */
export async function undoStep(input: { workspaceId: string; userId: string; role: string; messageId: string; index: number; now?: Date }): Promise<{ ok: boolean; message: string; threadId?: string }> {
  const now = input.now ?? new Date();
  const msg = await db.assistantMessage.findFirst({
    where: { id: input.messageId, role: "assistant", thread: { workspaceId: input.workspaceId, userId: input.userId } },
    select: { id: true, steps: true, threadId: true },
  });
  if (!msg) return { ok: false, message: "That reply isn't one of yours here." };
  const { readJson } = await import("@/lib/db/json");
  const steps = readJson<Array<{ kind: string; tool?: string; args?: Args; output?: string; undo?: StepUndo }>>(msg.steps, []);
  const step = steps[input.index];
  const u = step?.undo;
  if (!step || step.kind !== "tool" || !u?.state || !step.tool) return { ok: false, message: "That step can't be undone here.", threadId: msg.threadId };
  if (u.done) return { ok: false, message: "That was already undone.", threadId: msg.threadId };
  if (Date.parse(u.until) <= now.getTime()) return { ok: false, message: "Undo is only offered for ten minutes — change it back on its page.", threadId: msg.threadId };
  const { TOOLS_BY_NAME, toolAllowedFor } = await import("@/lib/assistant/tools");
  const def = TOOLS_BY_NAME.get(step.tool);
  const undoer = UNDOERS[step.tool];
  if (!def || !undoer || !toolAllowedFor(def, input.role) || (def.minRole === "ADMIN" && input.role !== "ADMIN")) return { ok: false, message: "Your role can't undo this.", threadId: msg.threadId };
  const ctx = { workspaceId: input.workspaceId, userId: input.userId, role: input.role };
  const current = await undoer.read(step.args ?? {}, ctx, step.output ?? null).catch(() => undefined);
  if (current === undefined || !same(current, u.state.after)) {
    return { ok: false, message: "It has changed since the assistant did it, so undoing would overwrite that — change it on its page instead.", threadId: msg.threadId };
  }
  // Claim: only if the stored steps are still what was read.
  const claimed = steps.map((st, i) => (i === input.index ? { ...st, undo: { ...u, done: now.toISOString() } } : st));
  const { writeJson } = await import("@/lib/db/json");
  const won = await db.assistantMessage.updateMany({ where: { id: msg.id, steps: msg.steps }, data: { steps: writeJson(claimed) } });
  if (won.count !== 1) return { ok: false, message: "That was already undone.", threadId: msg.threadId };
  let said: string;
  try {
    said = await undoer.write(u.state.before, u.state.after, ctx, step.args ?? {});
  } catch (e) {
    await db.assistantMessage.updateMany({ where: { id: msg.id }, data: { steps: msg.steps } });
    return { ok: false, message: e instanceof UndoRefused ? `Couldn't undo: ${e.message}.` : "Couldn't undo it — nothing was changed.", threadId: msg.threadId };
  }
  const { writeAudit } = await import("@/lib/governance");
  await writeAudit({ workspaceId: input.workspaceId, actorId: input.userId, action: "assistant.tool_undone", entityType: "assistant", entityId: msg.threadId, meta: { tool: step.tool, args: step.args ?? {}, messageId: msg.id, threadId: msg.threadId } });
  // The conversation says so, so the model reads it next turn and the person sees it.
  await db.assistantMessage.create({ data: { threadId: msg.threadId, role: "assistant", content: `↩ Undone — ${u.label.toLowerCase()}: ${said}.` } });
  await db.assistantThread.update({ where: { id: msg.threadId }, data: { updatedAt: now } });
  return { ok: true, message: `Undone: ${said}.`, threadId: msg.threadId };
}
