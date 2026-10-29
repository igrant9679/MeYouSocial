import { llm, resolveUsableModel } from "@/lib/llm";
import { randomBytes } from "node:crypto";
import { buildPreview, type ConfirmPreview } from "@/lib/assistant/preview";
import { db } from "@/lib/db";
import { brandContextBlock } from "@/lib/motifs";
import { channelBrief } from "@/lib/assistant/context";
import { APP_MAP_BRIEF } from "@/lib/assistant/knowledge";
import { REFUSED_INTENTS, TOOLS, confirmReason, runTool, type ToolContext } from "@/lib/assistant/tools";

/**
 * The assistant's turn loop.
 *
 * The LLM router is text-in/text-out — no native tool calling — so the protocol
 * is JSON the model writes and this file executes: one call per step, the
 * result fed back as an observation, until it answers or asks.
 *
 * Since 2026-09-08 the assistant can do nearly everything a person can do in
 * the app (the owner's ask). Three things keep that safe:
 *   · CONFIRMATION — a tool marked `confirm` is not run on the model's say-so.
 *     The loop turns the call into a question ("I'm about to … — go ahead?"),
 *     stores it as the thread's pending action, and runs it only when the
 *     person's NEXT message is a yes. A no clears it.
 *   · ROLE — a tool marked `minRole: "ADMIN"` refuses for editors, exactly as
 *     the page would.
 *   · AUDIT — every tool execution writes an audit row with its arguments.
 *
 * ⚠ A MOCK REPLY MUST NEVER DRIVE A TOOL. `LLMResponse.provider` is stamped by
 * the router, which falls back to the mock on any provider error — and mock
 * prose is fluent. The loop aborts the moment it sees `provider === "mock"`.
 *
 * ⚠ Steps are hard-capped. A model that loops on a failing tool would otherwise
 * spend the workspace's budget in a while(true).
 */

const MAX_STEPS = 10;

export type AssistantStep =
  | { kind: "tool"; tool: string; args: Record<string, unknown>; output: string; ok: boolean }
  | { kind: "answer"; text: string; links?: Array<{ label: string; href: string }> }
  | { kind: "ask"; text: string; options: string[] }
  /** A proposal (E-ENG-01): the card is built from `preview`; its Yes must carry `nonce`. */
  | { kind: "confirm"; tool: string; args: Record<string, unknown>; summary: string; nonce?: string; preview?: ConfirmPreview; expiresAt?: string };

export type PendingAction = { tool: string; args: Record<string, unknown>; summary: string; askedAt: string; nonce?: string };

export type AssistantResult = {
  ok: boolean;
  answer: string;
  steps: AssistantStep[];
  /** Quick-reply choices when the assistant asked a question. */
  options?: string[];
  /** Places to go next — rendered as buttons. */
  links?: Array<{ label: string; href: string }>;
  /** A proposal waiting for a yes; persisted on the thread by the caller. */
  pending?: PendingAction | null;
  /** Set when the run stopped for a reason worth showing rather than hiding. */
  error?: string;
};

function toolManual(): string {
  return TOOLS.map((t) => {
    const args = Object.entries(t.args).map(([k, v]) => `      "${k}": ${v}`).join("\n");
    const flags = [t.readOnly ? "read-only, cheap" : "", t.confirm ? "ASKS THE PERSON TO CONFIRM before running" : t.confirmWhen ? "ASKS THE PERSON TO CONFIRM when the engine would otherwise send or publish the result on its own" : "", t.minRole === "ADMIN" ? "admins only" : ""].filter(Boolean).join("; ");
    return `- ${t.name}${flags ? ` (${flags})` : ""}: ${t.description}${args ? `\n    args:\n${args}` : "\n    args: none"}`;
  }).join("\n");
}

const PROTOCOL = `Reply with EXACTLY ONE json object and nothing else — no prose around it, no markdown fence.

To use a tool:
{"tool": "<name>", "args": { ... }, "why": "<one short line the person will see, e.g. 'Approving the idea about donor fatigue'>"}

To ask the person a question before going on (when the request is ambiguous, or a choice is theirs):
{"ask": "<the question>", "options": ["<short choice>", "<short choice>", "..."]}

To answer the person (you are done for this turn):
{"answer": "<your reply, in plain words>", "links": [{"label": "<button text>", "href": "</path/in/the/app>"}]}`;

function systemPrompt(brand: string | null, workspaceName: string, role: string, page: string | null, channel: string | null): string {
  return `You are the assistant inside MeYouSocial Publisher (the product; MeYouSocial is the family brand), working for the company "${workspaceName}" alongside a person whose role is ${role}. You can do nearly everything they can do in the app, by calling tools, and you explain plainly what happened. You are also their guide: if they seem lost or ask what to do, call next_steps and lay out the next moves, most important first, and offer to do the first one.

${PROTOCOL}

Tools available to you:
${toolManual()}

The app you both live in — where things are and how it runs:
${APP_MAP_BRIEF}
${page ? `\nThe person is currently on the page ${page}. When they say "this" or "here", they mean what that page shows; use its ids when a tool needs one (an article id in /blog/<id>, a post id in /social/<id>/edit, a channel id in /channels/<id>/…).` : ""}

How to behave:
- Be interactive. When a request could mean two things, or a choice is theirs (which idea, which network, which day, publish now or on the publish day), use "ask" with short options rather than guessing. One question at a time.
- Look before making. When acting on existing content, list it first so you act on a real id, never a guessed one. Never pass a placeholder as an argument ("need to look it up", "unknown", "?") — call the listing tool, then the acting tool.
- Tools marked ASKS THE PERSON TO CONFIRM are not run on your say-so: just call them — the system turns the call into a question the person answers with yes or no. Do not ask "shall I?" yourself for those; call the tool and let the confirmation happen. Do not call them again while a confirmation is outstanding.
- Walk them through what you do: after a tool runs, say in one or two sentences what happened and what it means, then the natural next step, with a link to where it lives. Attach "links" whenever there is a page to open.
- Recommend. When asked what to do, or when you can see the better move, say which and why — briefly — then offer to do it.
- One tool per reply. You will be given its result and can then call another. Never claim you did something a tool did not report doing. Never invent an id, a statistic, a url or a quote; use search_web when a fact matters.
- Say where things land: a draft at review, a post as a draft or queued for a time, an article at final approval or published.
- Research conversations: a pasted YouTube link → analyze_youtube_video; a web link → read_web_page; "this channel" / "this video" on an Intel page → intel_channel / intel_video with the id from the URL; "[attached: …]" in a message → read_research_source. Think out loud with them about hooks, angles and remixes, and when they say "turn this into a script" (or you can see it is ready), call start_script with your synthesis as the brief.
- If the person asks for something no tool can do, say so plainly and name the page where they can:
${REFUSED_INTENTS.map((r) => `  · ${r}`).join("\n")}
${brand ? `\nWhat this company is and does — ground everything you write in it:\n${brand}` : ""}${channel ? `\n\n${channel}` : ""}`;
}

type Directive = {
  tool?: string;
  args?: Record<string, unknown>;
  why?: string;
  answer?: string;
  ask?: string;
  options?: string[];
  links?: Array<{ label: string; href: string }>;
};

/** Pull the one JSON object out of a reply, tolerating a stray fence or prose. */
export function parseDirective(raw: string): Directive | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const p = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          const links = Array.isArray(p.links)
            ? (p.links as unknown[]).filter((l): l is { label: string; href: string } => !!l && typeof l === "object" && typeof (l as { label?: unknown }).label === "string" && typeof (l as { href?: unknown }).href === "string" && String((l as { href: string }).href).startsWith("/")).slice(0, 6)
            : undefined;
          return {
            tool: typeof p.tool === "string" ? p.tool : undefined,
            args: (p.args && typeof p.args === "object" ? p.args : {}) as Record<string, unknown>,
            why: typeof p.why === "string" ? p.why : undefined,
            answer: typeof p.answer === "string" ? p.answer : undefined,
            ask: typeof p.ask === "string" ? p.ask : undefined,
            options: Array.isArray(p.options) ? (p.options as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 6) : undefined,
            links,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ⚠ A proposal runs only on a reply that is NOTHING BUT a yes. This used to be
// a prefix test, so "OK, actually no, cancel", "Go to the calendar instead" and
// "Sure, but change the text" all ran the proposed publish/send/invite. Now the
// whole message, minus punctuation, has to be one of these; anything else is a
// decline (if it says no anywhere) or a new request (the proposal lapses).
const YES_PHRASES = new Set([
  "y", "yes", "yep", "yeah", "yup", "ok", "okay", "sure", "do it", "go ahead", "go", "confirm",
  "confirmed", "proceed", "please do", "yes do it", "yes go ahead", "yes please", "ok do it",
  "okay do it", "yes proceed", "approve", "approved", "go for it", "👍",
]);
const NO = /(^|\b)(n|no|nope|cancel|stop|don'?t|do not|never ?mind|hold off|not now|abort|wait)\b/i;
/** Proposals older than this lapse instead of running on a late "ok". */
const PROPOSAL_TTL_MS = 15 * 60 * 1000;

export function isAffirmative(message: string): boolean {
  const normalised = message
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’()\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return YES_PHRASES.has(normalised);
}

export function proposalExpired(p: PendingAction, now = Date.now()): boolean {
  const asked = Date.parse(p.askedAt);
  return !Number.isFinite(asked) || now - asked > PROPOSAL_TTL_MS;
}

export async function runAssistant(
  ctx: ToolContext,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
  pending: PendingAction | null = null,
  /** The nonce a card's Yes carried; null for a typed message. */
  confirm: string | null = null,
): Promise<AssistantResult> {
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true, defaultModel: true } });
  if (!workspace) return { ok: false, answer: "", steps: [], error: "workspace not found" };
  const [brand, channel] = await Promise.all([
    brandContextBlock(ctx.workspaceId).catch(() => null),
    channelBrief(ctx.workspaceId, ctx.channelId).catch(() => null),
  ]);
  const system = systemPrompt(brand, workspace.name, ctx.role, ctx.page ?? null, channel);

  // ⚠ resolveUsableModel, not `defaultModel ?? env default` — a model id whose
  // provider has no key for THIS workspace resolves to the mock silently.
  const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, ctx.workspaceId);

  const steps: AssistantStep[] = [];
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [...history.slice(-12)];

  // ── A pending proposal: the person's message is the answer to it ──────────
  if (pending && proposalExpired(pending)) {
    // A "yes" long after the question is not consent to what was asked then.
    transcript.push({ role: "user", content: `${message}\n\n[an earlier proposal "${pending.summary}" expired unanswered and was NOT done; if the person is agreeing to it, propose it again so they can confirm it fresh]` });
  } else if (pending) {
    // A card's Yes is bound to ITS proposal (E-ENG-01): one from an older card —
    // another tab, a proposal since replaced — answers nothing.
    const byCard = confirm !== null;
    if (byCard && pending.nonce && confirm !== pending.nonce) {
      // Answered here, not by the model: nothing runs, and the proposal that IS
      // waiting stays waiting, its card drawn again with its own nonce.
      const preview = await buildPreview(pending.tool, pending.args, ctx);
      const expiresAt = new Date(Date.parse(pending.askedAt) + PROPOSAL_TTL_MS).toISOString();
      return {
        ok: true,
        answer: `That yes was pressed on an earlier proposal, so nothing was done. Still waiting on: **${pending.summary}**. Go ahead?`,
        steps: [{ kind: "confirm", tool: pending.tool, args: pending.args, summary: pending.summary, nonce: pending.nonce, preview, expiresAt }],
        options: ["Yes, do it", "No"],
        pending,
      };
    } else if (byCard || isAffirmative(message)) {
      // The re-check: the post or article still there, its time still ahead,
      // the role still allowed — what was shown may have changed since.
      const def = TOOLS.find((t) => t.name === pending.tool);
      const roleRefused = def?.minRole === "ADMIN" && ctx.role !== "ADMIN";
      const recheck = roleRefused ? null : await buildPreview(pending.tool, pending.args, ctx);
      const why = roleRefused ? "only an admin can do this" : recheck?.problem;
      if (why) {
        steps.push({ kind: "tool", tool: pending.tool, args: pending.args, output: `not run: ${why}`, ok: false });
        transcript.push({ role: "user", content: `${message}\n\n[the person said yes to "${pending.summary}", but on checking again just now: ${why}. It was NOT done — tell them plainly.]` });
      } else {
        const { ok, output } = await runTool(pending.tool, pending.args, ctx, { confirmed: true });
        steps.push({ kind: "tool", tool: pending.tool, args: pending.args, output, ok });
        transcript.push({ role: "assistant", content: JSON.stringify({ tool: pending.tool, args: pending.args, why: pending.summary }) });
        transcript.push({ role: "user", content: `[the person confirmed; tool result: ${pending.tool}]\n${output}\n\nNow tell them what happened and the natural next step.` });
      }
    } else if (NO.test(message)) {
      transcript.push({ role: "user", content: `${message}\n\n[the person declined the proposal "${pending.summary}"; it was NOT done. Acknowledge briefly and ask what they would like instead.]` });
    } else {
      // Neither — treat as a new request; the proposal lapses.
      transcript.push({ role: "user", content: `${message}\n\n[an earlier proposal "${pending.summary}" was left unanswered and has lapsed; do not run it unless asked again]` });
    }
  } else if (confirm !== null) {
    // A card's Yes with nothing waiting: it already ran, lapsed or was replaced.
    // Said here, plainly — a model asked to explain it might run something.
    return { ok: true, answer: "That proposal isn't waiting any more — it already ran, expired or was replaced — so nothing was done. Ask again if you still want it.", steps: [], pending: null };
  } else {
    transcript.push({ role: "user", content: message });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    // allowWhilePaused: the conversation itself still runs while paused (so the
    // person can ask what is happening and calm things down); the tools it
    // calls are gated in runTool.
    const res = await llm.complete({ model, system, messages: transcript, workspaceId: ctx.workspaceId, maxTokens: 2000, allowWhilePaused: true });

    if (res.provider === "mock") {
      return {
        ok: false, answer: "", steps,
        error: "This workspace has no working AI key, so I'd be guessing rather than thinking — and I'm not going to run anything against your content on a guess. Add a key under Settings → Keys.",
      };
    }

    const d = parseDirective(res.content);
    if (!d) {
      // Plain prose is a legitimate final answer — after a tool ran the model
      // often just tells the person what happened without the JSON wrapper.
      return { ok: true, answer: res.content.trim(), steps, pending: null };
    }

    if (d.ask !== undefined) {
      const options = d.options && d.options.length ? d.options : [];
      steps.push({ kind: "ask", text: d.ask, options });
      return { ok: true, answer: d.ask, steps, options, pending: null };
    }

    if (d.answer !== undefined) {
      steps.push({ kind: "answer", text: d.answer, links: d.links });
      return { ok: true, answer: d.answer, steps, links: d.links, pending: null };
    }

    if (!d.tool) return { ok: true, answer: "I couldn't work out what to do next.", steps, pending: null, error: "empty directive" };

    // A tool that needs the person's yes: propose it and stop.
    const def = TOOLS.find((t) => t.name === d.tool);
    const reason = def ? await confirmReason(def, d.args ?? {}, ctx) : null;
    if (def && reason !== null) {
      if (def.minRole === "ADMIN" && ctx.role !== "ADMIN") {
        transcript.push({ role: "assistant", content: JSON.stringify(d) });
        transcript.push({ role: "user", content: `[tool result: ${d.tool}]\nrefused: only an admin can do this — tell the person plainly and name the page where an admin does it.` });
        steps.push({ kind: "tool", tool: d.tool, args: d.args ?? {}, output: "refused: admins only", ok: false });
        continue;
      }
      // The card is built here, from the arguments — and a proposal that
      // couldn't run (the post is gone, the time has passed) isn't made.
      const preview = await buildPreview(d.tool, d.args ?? {}, ctx);
      if (preview.problem) {
        transcript.push({ role: "assistant", content: JSON.stringify(d) });
        transcript.push({ role: "user", content: `[tool result: ${d.tool}]\nnot proposed: ${preview.problem}` });
        steps.push({ kind: "tool", tool: d.tool, args: d.args ?? {}, output: `not proposed: ${preview.problem}`, ok: false });
        continue;
      }
      const summary = (d.why?.trim() || `${def.description.split(".")[0]}`) + (reason ? ` — ${reason}` : "");
      const askedAt = new Date();
      const nonce = randomBytes(9).toString("base64url");
      const proposal: PendingAction = { tool: d.tool, args: d.args ?? {}, summary, askedAt: askedAt.toISOString(), nonce };
      steps.push({ kind: "confirm", tool: d.tool, args: d.args ?? {}, summary, nonce, preview, expiresAt: new Date(askedAt.getTime() + PROPOSAL_TTL_MS).toISOString() });
      const answer = `I'm about to: **${summary}**. Go ahead?`;
      return { ok: true, answer, steps, options: ["Yes, do it", "No"], pending: proposal };
    }

    const { ok, output } = await runTool(d.tool, d.args ?? {}, ctx);
    steps.push({ kind: "tool", tool: d.tool, args: d.args ?? {}, output, ok });
    transcript.push({ role: "assistant", content: JSON.stringify({ tool: d.tool, args: d.args, why: d.why }) });
    transcript.push({ role: "user", content: `[tool result: ${d.tool}]\n${output}` });
  }

  const did = steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
  return {
    ok: true,
    steps,
    pending: null,
    answer: did.length
      ? `I ran out of steps before finishing. What I did: ${did.map((s) => s.tool).join(", ")}. Tell me to carry on if you want the rest.`
      : "I ran out of steps without getting anywhere — try asking for one thing at a time.",
    error: "step cap reached",
  };
}
