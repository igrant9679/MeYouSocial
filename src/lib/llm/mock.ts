import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

// A deterministic-ish fake provider used when USE_MOCK_LLM=true.
// Produces plausible YouTube-scripty output without calling any network.

const HOOK_OPENERS = [
  "Most creators get this wrong.",
  "Here's something nobody talks about.",
  "The first 30 seconds decide everything.",
  "I tried this for 90 days, and the results shocked me.",
  "Stop. Before you click away — watch this.",
];

const FILLER = [
  "Let's break it down step by step.",
  "Here's the part that surprised me.",
  "And that's where things get interesting.",
  "If you take only one thing from this video, take this:",
  "Now, real quick — let me give you context.",
];

function pseudoRandom(seed: string): () => number {
  // tiny mulberry32
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMockReply(req: LLMRequest): string {
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const rand = pseudoRandom((req.system ?? "") + last + req.model);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  // Detect intent by a few keywords; otherwise produce a generic outline.
  const text = last.toLowerCase();

  if (text.includes("outline") || text.includes("plan")) {
    return [
      `# Outline (mock — ${req.model})`,
      "",
      "**Hook (0:00-0:30)**",
      `- ${pick(HOOK_OPENERS)}`,
      `- Promise: viewer learns what matters about "${last.slice(0, 60)}".`,
      "",
      "**Section 1 — Setup the problem**",
      `- ${pick(FILLER)}`,
      "- Establish why this matters now.",
      "",
      "**Section 2 — The mechanism**",
      "- Explain the underlying idea in plain language.",
      "- One concrete example.",
      "",
      "**Section 3 — Application**",
      "- What to do tomorrow.",
      "- Common failure modes.",
      "",
      "**Conclusion + CTA**",
      "- Recap in 3 lines.",
      "- Subscribe + watch this next video →",
    ].join("\n");
  }

  if (text.includes("idea") || text.includes("ideas")) {
    // ⚠ No invented outlier multiplier here. This branch used to emit
    // `Outlier ${(1 + rand() * 9).toFixed(1)}x` — a number derived from a PRNG
    // seeded on the prompt, indistinguishable in the UI from a real ratio of
    // seed views to a competitor's average. It was also the only branch that
    // never said "mock", so a workspace with no API key (a fresh tenant hits
    // exactly this: no key → mockProvider, no warning) got five plausible ideas
    // carrying fabricated performance figures. An outlier ratio is measured or
    // it is absent — the same rule the real discovery path follows.
    //
    // One idea per line, "title — strategy", which is the shape the ideas job
    // asks for and parses. The old bold-heading-plus-bullet layout emitted two
    // lines per idea, so every other row stored as an "idea" was really its
    // bullet ("Outlier 3.4x · Suggested length 8–12 min · …").
    // Exactly ONE em-dash per line: the job splits on it to get title/strategy,
    // so nothing else here may contain one (two of the HOOK_OPENERS do, which
    // is why they aren't reused for this branch).
    return Array.from(
      { length: 10 },
      (_, i) =>
        `[mock ${i + 1}: no API key] Placeholder idea, not generated — add a key under Admin → API keys to generate for real.`,
    ).join("\n");
  }

  // Default: a short scripty paragraph.
  return [
    pick(HOOK_OPENERS),
    "",
    `(mock output from ${req.model}) — this provider is a stand-in. Replace USE_MOCK_LLM=false in .env and supply a real key to see real generations.`,
    "",
    pick(FILLER),
    pick(FILLER),
  ].join("\n");
}

export const mockProvider: LLMProvider = {
  id: "mock",
  supports: () => true,
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const content = buildMockReply(req);
    return {
      model: req.model,
      content,
      inputTokens: Math.ceil((req.messages.map((m) => m.content).join(" ").length) / 4),
      outputTokens: Math.ceil(content.length / 4),
    };
  },
  async *stream(req: LLMRequest): AsyncIterable<string> {
    const content = buildMockReply(req);
    // Stream by word with tiny delays so the UI can show progressive output.
    for (const chunk of content.split(/(\s+)/)) {
      await new Promise((r) => setTimeout(r, 8));
      yield chunk;
    }
  },
};
