import { llm, resolveUsableModel } from "@/lib/llm";
import { db } from "@/lib/db";
import { brandContextBlock } from "@/lib/motifs";
import { REFUSED_INTENTS, TOOLS, runTool, type ToolContext } from "@/lib/assistant/tools";

/**
 * The cross-app assistant's turn loop.
 *
 * The LLM router is text-in/text-out — no native tool calling — so the protocol
 * is JSON the model writes and this file executes: one call per step, the
 * result fed back as an observation, until it answers. That is the same
 * hand-rolled-over-a-dependency choice the Zernio and gdrive clients made.
 *
 * ⚠ A MOCK REPLY MUST NEVER DRIVE A TOOL. `LLMResponse.provider` is stamped by
 * the router, which falls back to the mock on any provider error — and mock
 * prose is fluent. Fluent nonsense choosing which cores to run against a real
 * workspace is the worst version of this codebase's oldest bug, so the loop
 * aborts the moment it sees `provider === "mock"` and says so.
 *
 * ⚠ Steps are hard-capped. A model that loops on a failing tool would otherwise
 * spend the workspace's budget in a while(true).
 */

const MAX_STEPS = 6;

export type AssistantStep =
  | { kind: "tool"; tool: string; args: Record<string, unknown>; output: string; ok: boolean }
  | { kind: "answer"; text: string };

export type AssistantResult = {
  ok: boolean;
  answer: string;
  steps: AssistantStep[];
  /** Set when the run stopped for a reason worth showing rather than hiding. */
  error?: string;
};

function toolManual(): string {
  return TOOLS.map((t) => {
    const args = Object.entries(t.args).map(([k, v]) => `      "${k}": ${v}`).join("\n");
    return `- ${t.name}${t.readOnly ? " (read-only, cheap)" : ""}: ${t.description}${args ? `\n    args:\n${args}` : "\n    args: none"}`;
  }).join("\n");
}

const PROTOCOL = `Reply with EXACTLY ONE json object and nothing else — no prose around it, no markdown fence.

To use a tool:
{"tool": "<name>", "args": { ... }, "why": "<one short line the user will see>"}

To answer the user (you are done):
{"answer": "<your reply to the user>"}`;

function systemPrompt(brand: string | null, workspaceName: string): string {
  return `You are the assistant inside MeYouSocial, working for the company "${workspaceName}". You get things done by calling tools, then explaining plainly what happened.

${PROTOCOL}

Tools available to you:
${toolManual()}

Rules that matter:
- Prefer looking before making. When asked to do something to existing content, list it first so you act on a real id rather than a guessed one.
- One tool per reply. You will be given its result and can then call another.
- Never claim you did something a tool did not report doing. If a tool says it created nothing, say that.
- Never invent an id, a statistic, a url or a quote. Use search_web when a fact matters.
- Everything you make lands where a human reviews it. Say so; do not imply anything is live or sent.
- If the user asks for something you cannot do, answer plainly that you can't, name the place in the app where they can, and stop. You cannot do any of these:
${REFUSED_INTENTS.map((r) => `  · ${r}`).join("\n")}
${brand ? `\nWhat this company is and does — ground everything you write in it:\n${brand}` : ""}`;
}

/** Pull the one JSON object out of a reply, tolerating a stray fence or prose. */
export function parseDirective(raw: string): { tool?: string; args?: Record<string, unknown>; why?: string; answer?: string } | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Walk to the matching brace so trailing prose can't break the parse.
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
          const parsed = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          return {
            tool: typeof parsed.tool === "string" ? parsed.tool : undefined,
            args: (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>,
            why: typeof parsed.why === "string" ? parsed.why : undefined,
            answer: typeof parsed.answer === "string" ? parsed.answer : undefined,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function runAssistant(
  ctx: ToolContext,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
): Promise<AssistantResult> {
  const workspace = await db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true, defaultModel: true } });
  if (!workspace) return { ok: false, answer: "", steps: [], error: "workspace not found" };
  const brand = await brandContextBlock(ctx.workspaceId).catch(() => null);
  const system = systemPrompt(brand, workspace.name);

  // ⚠ resolveUsableModel, not `defaultModel ?? env default`. A model id whose
  // provider has no key for THIS workspace resolves to the mock silently, and
  // the env default is `claude-sonnet` — so a workspace holding only a Google
  // key would refuse every turn with "no working AI key" while being fully
  // configured. That is the documented trap this helper exists for, and this
  // file walked straight into it until a fixture with a Google key proved it.
  const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, ctx.workspaceId);

  const steps: AssistantStep[] = [];
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-10),
    { role: "user", content: message },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.complete({
      model,
      system,
      messages: transcript,
      workspaceId: ctx.workspaceId,
      maxTokens: 2000,
    });

    if (res.provider === "mock") {
      return {
        ok: false,
        answer: "",
        steps,
        error:
          "This workspace has no working AI key, so I'd be guessing rather than thinking — and I'm not going to run anything against your content on a guess. Add a key under Admin → API keys.",
      };
    }

    const directive = parseDirective(res.content);
    if (!directive) {
      // Not JSON: treat it as the answer rather than losing the reply, but only
      // when nothing has been done yet — mid-run gibberish should stop.
      if (steps.length === 0) return { ok: true, answer: res.content.trim(), steps };
      return { ok: true, answer: res.content.trim(), steps, error: "the model stopped following the tool protocol" };
    }

    if (directive.answer !== undefined) {
      steps.push({ kind: "answer", text: directive.answer });
      return { ok: true, answer: directive.answer, steps };
    }

    if (!directive.tool) {
      return { ok: true, answer: "I couldn't work out what to do next.", steps, error: "empty directive" };
    }

    const { ok, output } = await runTool(directive.tool, directive.args ?? {}, ctx);
    steps.push({ kind: "tool", tool: directive.tool, args: directive.args ?? {}, output, ok });

    transcript.push({ role: "assistant", content: JSON.stringify({ tool: directive.tool, args: directive.args, why: directive.why }) });
    transcript.push({ role: "user", content: `[tool result: ${directive.tool}]\n${output}` });
  }

  // Out of steps. Say what was done rather than pretending it finished.
  const did = steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
  return {
    ok: true,
    answer:
      `I stopped after ${MAX_STEPS} steps without finishing. ` +
      (did.length ? `What I did do: ${did.map((s) => `${s.tool} → ${s.output.split("\n")[0]}`).join("; ")}.` : "Nothing was changed."),
    steps,
    error: "step limit reached",
  };
}
