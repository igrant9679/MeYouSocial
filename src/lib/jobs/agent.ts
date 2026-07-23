import { jobs } from "@/lib/jobs";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { email } from "@/lib/email";
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

      const voice = script.channel.voiceProfiles[0]?.data ?? "";
      const audienceKQ = readJson<string[]>(script.channel.audience?.keyQuestions ?? null, []);
      const templateName = script.template?.name ?? "Flexible";

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
        model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
        system: systemForOutline({
          channelName: script.channel.name,
          niche: script.channel.nicheDescription ?? "",
          differentiation: script.channel.differentiation ?? "",
          audienceKQ,
          voice,
          template: templateName,
        }),
        messages: [{ role: "user", content: `Title: ${script.title}\n\nResearch:\n${researchText}` }],
        workspaceId: script.channel.workspaceId,
      });
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: outline", outline: outlineRes.content } });
      const outlineJson = readJson<{ markdown?: string; questions?: unknown; publish?: unknown }>(script.outline ?? null, {});
      outlineJson.markdown = outlineRes.content;
      await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outlineJson), status: "planning" } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled after outline.");
      await mark("outline", { status: "done", endedAt: new Date().toISOString() });

      // ── 3. Script ──────────────────────────────────────────────────────
      await mark("script", { status: "running", startedAt: new Date().toISOString() });
      const scriptRes = await llm.complete({
        model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
        system: systemForScript({
          channelName: script.channel.name,
          niche: script.channel.nicheDescription ?? "",
          voice,
          template: templateName,
          lengthGuide: "8-12 minutes (~1500-2400 words)",
        }),
        messages: [{ role: "user", content: `Outline:\n\n${outlineRes.content}\n\nExpand into a full spoken-style script.` }],
        workspaceId: script.channel.workspaceId,
      });
      let body = scriptRes.content;
      let wordCount = countWords(body);
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: script-draft", body, wordCount } });
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount), status: "draft" } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled after first draft.");
      await mark("script", { status: "done", endedAt: new Date().toISOString(), note: `${wordCount} words` });

      // ── 4a. QA: retention optimization ─────────────────────────────────
      await mark("qa_retention", { status: "running", startedAt: new Date().toISOString() });
      const retention = await llm.complete({
        model: script.model ?? "claude-sonnet",
        system: "Pass over a YouTube script and improve retention: punch up the hook, add curiosity gaps between sections, ensure every 30s makes a promise or pays one off. PRESERVE voice and structure. Return ONLY the rewritten script.",
        messages: [{ role: "user", content: body }],
        workspaceId: script.channel.workspaceId,
      });
      body = retention.content;
      wordCount = countWords(body);
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_retention", { status: "done", endedAt: new Date().toISOString() });

      // ── 4b. QA: humanize ───────────────────────────────────────────────
      await mark("qa_humanize", { status: "running", startedAt: new Date().toISOString() });
      const humanized = await llm.complete({
        model: script.model ?? "claude-sonnet",
        system: HUMANIZE_SYSTEM,
        messages: [{ role: "user", content: `Voice: ${voice}\n\nScript:\n${body}` }],
        workspaceId: script.channel.workspaceId,
      });
      body = humanized.content;
      wordCount = countWords(body);
      await db.scriptVersion.create({ data: { scriptId: script.id, label: "agent: humanized", body, wordCount } });
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_humanize", { status: "done", endedAt: new Date().toISOString() });

      // ── 4c. QA: repetition cleanup ─────────────────────────────────────
      await mark("qa_repetition", { status: "running", startedAt: new Date().toISOString() });
      const dedup = await llm.complete({
        model: script.model ?? "claude-sonnet",
        system: "Pass over a YouTube script and remove repeated points, redundant phrasings, and any place where the same idea is restated within two paragraphs. Keep length within 5% of the original. PRESERVE voice. Return ONLY the rewritten script.",
        messages: [{ role: "user", content: body }],
        workspaceId: script.channel.workspaceId,
      });
      body = dedup.content;
      wordCount = countWords(body);
      await db.script.update({ where: { id: script.id }, data: { body, wordCount: Math.min(wordCount, MAX_WORDS), durationSeconds: durationSeconds(wordCount) } });
      if (await isCancelled()) return await finish("cancelled", "Cancelled mid-QA.");
      await mark("qa_repetition", { status: "done", endedAt: new Date().toISOString() });

      // ── 5. Voiceover prep ──────────────────────────────────────────────
      await mark("voiceover", { status: "running", startedAt: new Date().toISOString() });
      const vo = await llm.complete({
        model: script.model ?? "claude-sonnet",
        system: "Format a script for AI voiceover: 1 sentence per line, no slashes, no parentheticals the narrator would read aloud, no em-dashes (replace with commas), expand 'e.g.'/'i.e.'/etc. Keep section headers as their own lines. Return ONLY the formatted script.",
        messages: [{ role: "user", content: body }],
        workspaceId: script.channel.workspaceId,
      });
      body = vo.content;
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
      // email on completion (mocked in dev).
      if (state === "succeeded") {
        const sc = await db.script.findUnique({ where: { id: scriptId }, include: { channel: true, author: true } });
        if (sc?.author?.email) {
          // Background job — no request scope, so getPublicUrl() falls back to env.APP_URL.
          const origin = await getPublicUrl();
          await email.send({
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
