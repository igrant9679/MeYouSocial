import { jobs } from "@/lib/jobs";
import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import type { LLMResponse } from "@/lib/llm";
import { emailFor } from "@/lib/email";
import { readJson, writeJson } from "@/lib/db/json";
import { countWords, durationSeconds, MAX_WORDS } from "@/lib/canvas/duration";
import { systemForOutline, systemForScript, HUMANIZE_SYSTEM } from "@/lib/canvas/prompts";
import { getPublicUrl } from "@/lib/public-url";

//..04, 06 — automated pipeline:
//   Research → Outline → Script → QA (retention + humanize + repetition cleanup) → VO prep.
// Output lands in the same Script row, so all editing tools (Highlight-and-Improve,
// Humanize, chat, version history) work on it.

type Payload = { runId: string; scriptId: string };

const STEPS = [
  "research",
  "outline",
  "script",
  "qa_retention",
  "qa_humanize",
  "qa_repetition",
  "voiceover",
] as const;
type Step = (typeof STEPS)[number];

type StepState = { name: Step; status: "queued" | "running" | "done" | "failed" | "cancelled"; startedAt?: string; endedAt?: string; note?: string };

let registered = false;
export function registerAgentJobs() {
  if (registered) return;
  registered = true;

  jobs.register<Payload>("agent.run", async ({ runId, scriptId }, ctx) => {
    const run = await db.agentRun.findUnique({ where: { id: runId } });
    if (!run) return;

    // Build the step-state ledger
    const steps: StepState[] = STEPS.map((s) => ({ name: s, status: "queued" }));
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date(), steps: writeJson(steps), progress: 0 },
    });

    async function mark(stepName: Step, patch: Partial<StepState>) {
      const idx = steps.findIndex((s) => s.name === stepName);
      steps[idx] = { ...steps[idx], ...patch };
      // Recompute progress as ratio of done steps
      const done = steps.filter((s) => s.status === "done").length;
      await db.agentRun.update({
        where: { id: runId },
        data: { steps: writeJson(steps), progress: done / STEPS.length },
      });
      await ctx.progress(done / STEPS.length);
    }

    async function isCancelled(): Promise<boolean> {
      const r = await db.agentRun.findUnique({ where: { id: runId } });
      return r?.status === "cancelled";
    }

    // Tiny breather so the UI can show streaming progress with mock LLM.
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      const script = await db.script.findUnique({
        where: { id: scriptId },
        include: {
          channel: { include: { voiceProfiles: { where: { isDefault: true } }, audience: true } },
          template: true,
          research: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });
      if (!script) throw new Error("script not found");
      // The agent rewrites outline and body; keep the hand-edited draft first.
      const { snapshotScript } = await import("@/lib/script-versions");
      await snapshotScript(script, "before agent run");

      const voice = script.channel.voiceProfiles[0]?.data ?? "";
      const audienceKQ = readJson<string[]>(script.channel.audience?.keyQuestions ?? null, []);
      const templateName = script.template?.name ?? "Flexible";
      // One model the workspace can actually reach, for every step (ENG-06).
      // Each step asked for script.model ?? "claude-sonnet", and a step that hit
      // the router's mock (no key, or the 45 s timeout on a long script)
      // overwrote the script with placeholder text and still emailed "Your
      // script is ready".
      const model = await resolveUsableModel(script.model ?? script.channel.defaultModel ?? "", script.channel.workspaceId);
      const call = { model, workspaceId: script.channel.workspaceId, timeoutMs: 240_000, maxTokens: 8000 };
      /** A placeholder stops the run BEFORE it is written anywhere. */
      const real = (res: LLMResponse, step: string): string => {
        if (res.provider === "mock" || !res.content.trim()) {
          throw new Error(`The AI provider didn't answer at the ${step} step (no usable key, or it timed out), so the run stopped there. Nothing from that step was written; the script as it was before the run is in its version history.`);
        }
        return res.content;
      };

      // ── 1. Research ────────────────────────────────────────────────────
      await mark("research", { status: "running", startedAt: new Date().toISOString() });
      const researchText = script.research
        .map((r) => `- [${r.kind}] ${r.title ?? r.ref}: ${(r.content ?? "").slice(0, 400)}`)
        .join("\n") || "(no attached research; LLM will work from voice + audience only)";
      ctx.log("research collected: " + script.research.length + " sources");
      await pause(800);
      if (await isCancelled()) return await finish("cancelled", "Cancelled during research.");
      await mark("research", { status: "done", endedAt: new Date().toISOString(), note: `${script.research.length} sources` });

      // ── 2. Outline ─────────────────────────────────────────────────────
      await mark("outline", { status: "running", startedAt: new Date().toISOString() });
      const outlineRes = await llm.complete({
        ...call,
        system: systemForOutline({
          channelName: script.channel.name,
          niche: script.channel.nicheDescription ?? "",
          differentiation: script.channel.differentiation ?? "",
          audienceKQ,
          voice,
          template: templateName,
        }),
        messages: [{ role: "user", content: `Title: ${script.title}\n\nResearch:\n${researchText}` }],
      });
      const outline = real(outlineRes, "outline");
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: outline", outline } });
      const outlineJson = readJson<{ markdown?: string; questions?: unknown; publish?: unknown }>(script.outline ?? null, {});
      outlineJson.markdown = outline;
      await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outlineJson), status: "planning" } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled after outline.");
      await mark("outline", { status: "done", endedAt: new Date().toISOString() });

      // ── 3. Script ──────────────────────────────────────────────────────
      await mark("script", { status: "running", startedAt: new Date().toISOString() });
      const scriptRes = await llm.complete({
        ...call,
        system: systemForScript({
          channelName: script.channel.name,
          niche: script.channel.nicheDescription ?? "",
          voice,
          template: templateName,
          lengthGuide: "8-12 minutes (~1500-2400 words)",
        }),
        messages: [{ role: "user", content: `Outline:\n\n${outline}\n\nExpand into a full spoken-style script.` }],
      });
      let body = real(scriptRes, "script");
      let wordCount = countWords(body);
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: script-draft", body, wordCount } });
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount), status: "draft" } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled after first draft.");
      await mark("script", { status: "done", endedAt: new Date().toISOString(), note: `${wordCount} words` });

      // ── 4a. QA: retention optimization ─────────────────────────────────
      await mark("qa_retention", { status: "running", startedAt: new Date().toISOString() });
      const retention = await llm.complete({
        ...call,
        system: "Pass over a YouTube script and improve retention: punch up the hook, add curiosity gaps between sections, ensure every 30s makes a promise or pays one off. PRESERVE voice and structure. Return ONLY the rewritten script.",
        messages: [{ role: "user", content: body }],
      });
      body = real(retention, "retention");
      wordCount = countWords(body);
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_retention", { status: "done", endedAt: new Date().toISOString() });

      // ── 4b. QA: humanize ───────────────────────────────────────────────
      await mark("qa_humanize", { status: "running", startedAt: new Date().toISOString() });
      const humanized = await llm.complete({
        ...call,
        system: HUMANIZE_SYSTEM,
        messages: [{ role: "user", content: `Voice: ${voice}\n\nScript:\n${body}` }],
      });
      body = real(humanized, "humanize");
      wordCount = countWords(body);
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: humanized", body, wordCount } });
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_humanize", { status: "done", endedAt: new Date().toISOString() });

      // ── 4c. QA: repetition cleanup ─────────────────────────────────────
      await mark("qa_repetition", { status: "running", startedAt: new Date().toISOString() });
      const dedup = await llm.complete({
        ...call,
        system: "Pass over a YouTube script and remove repeated points, redundant phrasings, and any place where the same idea is restated within two paragraphs. Keep length within 5% of the original. PRESERVE voice. Return ONLY the rewritten script.",
        messages: [{ role: "user", content: body }],
      });
      body = real(dedup, "repetition");
      wordCount = countWords(body);
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_repetition", { status: "done", endedAt: new Date().toISOString() });

      // ── 5. Voiceover prep ──────────────────────────────────────────────
      await mark("voiceover", { status: "running", startedAt: new Date().toISOString() });
      const vo = await llm.complete({
        ...call,
        system: "Format a script for AI voiceover: 1 sentence per line, no slashes, no parentheticals the narrator would read aloud, no em-dashes (replace with commas), expand 'e.g.'/'i.e.'/etc. Keep section headers as their own lines. Return ONLY the formatted script.",
        messages: [{ role: "user", content: body }],
      });
      body = real(vo, "voiceover");
      wordCount = countWords(body);
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: voiceover-ready", body, wordCount } });
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount), status: "ready" } });
      await mark("voiceover", { status: "done", endedAt: new Date().toISOString() });

      await finish("succeeded");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "failed", endedAt: new Date(), error: message },
      });
    }

    async function finish(state: "succeeded" | "cancelled", note?: string) {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: state, endedAt: new Date(), progress: state === "succeeded" ? 1 : run!.progress },
      });
      // Email on completion — through the WORKSPACE's mailer, not the bare
      // app-level `email` export. The bare export skips Unipile (it has no
      // workspace to resolve a mailbox for), and Railway blocks SMTP, so this
      // notice silently landed in the mock and nobody ever received it — while
      // the Help page said, correctly at the time, that no email existed.
      // Routing through emailFor(workspaceId) makes it real wherever a mailbox
      // is connected, and an honest mock (console log) where none is.
      if (state === "succeeded") {
        const sc = await db.script.findUnique({ where: { id: scriptId }, include: { channel: true, author: true } });
        if (sc?.author?.email) {
          // Background job — no request scope, so getPublicUrl() falls back to env.APP_URL.
          const origin = await getPublicUrl();
          await emailFor(sc.channel.workspaceId).send({
            to: sc.author.email,
            subject: `Your script is ready: ${sc.title}`,
            html: `<p>Agent Mode finished a script for <b>${sc.channel.name}</b>.</p>
                   <p><a href="${origin}/scripts/${sc.id}">Open in Canvas →</a></p>`,
          });
        }
      } else if (note) {
        ctx.log("agent finish " + state + ": " + note);
      }
    }
  });
}
