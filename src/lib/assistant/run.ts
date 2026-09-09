import { llm, resolveUsableModel } from "@/lib/llm";
import { db } from "@/lib/db";
import { brandContextBlock } from "@/lib/motifs";
import { APP_MAP_BRIEF } from "@/lib/assistant/knowledge";
import { REFUSED_INTENTS, TOOLS, runTool, type ToolContext } from "@/lib/assistant/tools";

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
  | { kind: "confirm"; tool: string; args: Record<string, unknown>; summary: string };

export type PendingAction = { tool: string; args: Record<string, unknown>; summary: string; askedAt: string };

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
    const flags = [t.readOnly ? "read-only, cheap" : "", t.confirm ? "ASKS THE PERSON TO CONFIRM before running" : "", t.minRole === "ADMIN" ? "admins only" : ""].filter(Boolean).join("; ");
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

function systemPrompt(brand: string | null, workspaceName: string, role: string, page: string | null): string {
  return `You are the assistant inside MeYouSocial, working for the company "${workspaceName}" alongside a person whose role is ${role}. You can do nearly everything they can do in the app, by calling tools, and you explain plainly what happened. You are also their guide: if they seem lost or ask what to do, call next_steps and lay out the next moves, most important first, and offer to do the first one.

${PROTOCOL}

Tools available to you:
${toolManual()}

The app you both live in — where things are and how it runs:
${APP_MAP_BRIEF}
${page ? `\nThe person is currently on the page ${page}. When they say "this" or "here", they mean what that page shows; use its ids when a tool needs one (an article id in /blog/<id>, a post id in /social/<id>/edit, a channel id in /channels/<id>/…).` : ""}

How to behave:
- Be interactive. When a request could mean two things, or a choice is theirs (which idea, which network, which day, publish now or on the publish day), use "ask" with short options rather than guessing. One question at a time.
- Look before making. When acting on existing content, list it first so you act on a real id, never a guessed one.
- Tools marked ASKS THE PERSON TO CONFIRM are not run on your say-so: just call them — the system turns the call into a question the person answers with yes or no. Do not ask "shall I?" yourself for those; call the tool and let the confirmation happen. Do not call them again while a confirmation is outstanding.
- Walk them through what you do: after a tool runs, say in one or two sentences what happened and what it means, then the natural next step, with a link to where it lives. Attach "links" whenever there is a page to open.
- Recommend. When asked what to do, or when you can see the better move, say which and why — briefly — then offer to do it.
- One tool per reply. You will be given its result and can then call another. Never claim you did something a tool did not report doing. Never invent an id, a statistic, a url or a quote; use search_web when a fact matters.
- Say where things land: a draft at review, a post as a draft or queued for a time, an article at final approval or published.
- If the person asks for something no tool can do, say so plainly and name the page where they can:
${REFUSED_INTENTS.map((r) => `  · ${r}`).join("\n")}
${brand ? `\nWhat this company is and does — ground everything you write in it:\n${brand}` : ""}`;
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

const YES = /^\s*(y|yes|yep|yeah|yup|ok|okay|sure|do it|go ahead|go|confirm|confirmed|proceed|please do|yes,? do it|yes,? go ahead)\b/i;
const NO = /^\s*(n|no|nope|cancel|stop|don'?t|do not|never ?mind|hold off|not now|abort)\b/i;

export async function runAssistant(
  ctx: ToolContext,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
  pending: PendingAction | null = null,
): Promise<AssistantResult> {
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true, defaultModel: true } });
  if (!workspace) return { ok: false, answer: "", steps: [], error: "workspace not found" };
  const brand = await brandContextBlock(ctx.workspaceId).catch(() => null);
  const system = systemPrompt(brand, workspace.name, ctx.role, ctx.page ?? null);

  // ⚠ resolveUsableModel, not `defaultModel ?? env default` — a model id whose
  // provider has no key for THIS workspace resolves to the mock silently.
  const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, ctx.workspaceId);

  const steps: AssistantStep[] = [];
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [...history.slice(-12)];

  // ── A pending proposal: the person's message is the answer to it ──────────
  if (pending) {
    if (YES.test(message)) {
      const { ok, output } = await runTool(pending.tool, pending.args, ctx, { confirmed: true });
      steps.push({ kind: "tool", tool: pending.tool, args: pending.args, output, ok });
      transcript.push({ role: "assistant", content: JSON.stringify({ tool: pending.tool, args: pending.args, why: pending.summary }) });
      transcript.push({ role: "user", content: `[the person confirmed; tool result: ${pending.tool}]\n${output}\n\nNow tell them what happened and the natural next step.` });
    } else if (NO.test(message)) {
      transcript.push({ role: "user", content: `${message}\n\n[the person declined the proposal "${pending.summary}"; it was NOT done. Acknowledge briefly and ask what they would like instead.]` });
    } else {
      // Neither — treat as a new request; the proposal lapses.
      transcript.push({ role: "user", content: `${message}\n\n[an earlier proposal "${pending.summary}" was left unanswered and has lapsed; do not run it unless asked again]` });
    }
  } else {
    transcript.push({ role: "user", content: message });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.complete({ model, system, messages: transcript, workspaceId: ctx.workspaceId, maxTokens: 2000 });

    if (res.provider === "mock") {
      return {
        ok: false, answer: "", steps,
        error: "This workspace has no working AI key, so I'd be guessing rather than thinking — and I'm not going to run anything against your content on a guess. Add a key under Admin → API keys.",
      };
    }

    const d = parseDirective(res.content);
    if (!d) {
      if (steps.length === 0) return { ok: true, answer: res.content.trim(), steps, pending: null };
      return { ok: true, answer: res.content.trim(), steps, pending: null, error: "the model stopped following the tool protocol" };
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
    if (def?.confirm) {
      if (def.minRole === "ADMIN" && ctx.role !== "ADMIN") {
        transcript.push({ role: "assistant", content: JSON.stringify(d) });
        transcript.push({ role: "user", content: `[tool result: ${d.tool}]\nrefused: only an admin can do this — tell the person plainly and name the page where an admin does it.` });
        steps.push({ kind: "tool", tool: d.tool, args: d.args ?? {}, output: "refused: admins only", ok: false });
        continue;
      }
      const summary = d.why?.trim() || `${def.description.split(".")[0]}`;
      const proposal: PendingAction = { tool: d.tool, args: d.args ?? {}, summary, askedAt: new Date().toISOString() };
      steps.push({ kind: "confirm", tool: d.tool, args: d.args ?? {}, summary });
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
