/**
 * Registry of AI-assistable fields.
 *
 * One entry per description-style field in the app. The key travels from the
 * component to the server action, so the action never accepts a caller-supplied
 * prompt — a client that could hand over arbitrary instructions would be a way
 * to spend the workspace's LLM budget on anything at all.
 *
 * ⚠ Only fields that want PROSE belong here. Names, handles, URLs, numbers,
 * single-word answers and anything backed by a dropdown are excluded on
 * purpose: there is nothing for a model to add, and a button beside them
 * implies the app can guess an answer only the user knows.
 */

export type AssistField = {
  /** Human label, used in the UI and in the prompt. */
  label: string;
  /** What good looks like. Written as an instruction TO the model. */
  instruction: string;
  /** Soft ceiling. The prompt asks for it; nothing truncates. */
  maxWords: number;
  /** Which workspace/channel facts to feed in. Only what the field needs —
   *  a bigger prompt is not a better one, and it costs tokens per click. */
  context: ReadonlyArray<"workspace" | "channel" | "brand" | "motifs">;
};

export const ASSIST_FIELDS = {
  // ── Onboarding ────────────────────────────────────────────────────────────
  "channel.nicheDescription": {
    label: "Channel description",
    instruction:
      "Describe what this channel is about: the subject, who it is for, and what a viewer gets from it. " +
      "Concrete and specific — name the actual topics rather than saying \"valuable content\". No marketing superlatives.",
    maxWords: 90,
    context: ["workspace", "channel"],
  },
  "channel.differentiation": {
    label: "What makes this channel different",
    instruction:
      "State what this channel does that competitors in the same niche do not. " +
      "One clear, falsifiable claim about approach or evidence — the kind of thing a viewer could check. " +
      "Avoid \"high quality\", \"unique insights\" and anything every channel would also say.",
    maxWords: 60,
    context: ["workspace", "channel"],
  },
  "channel.presentationStyle": {
    label: "Presentation style",
    instruction:
      "Describe how this creator presents: tone, pace, and format habits. Plain description, not praise.",
    maxWords: 50,
    context: ["workspace", "channel"],
  },
  "workspace.description": {
    label: "Company description",
    instruction:
      "Describe what this company does, for whom, and what problem it solves. Factual and specific; no taglines.",
    maxWords: 80,
    context: ["workspace"],
  },

  // ── Brand ─────────────────────────────────────────────────────────────────
  "topic.description": {
    label: "Topic description",
    instruction:
      "Describe what this content topic covers and the angle this company takes on it. " +
      "Say what would and would not belong under it.",
    maxWords: 60,
    context: ["workspace", "brand", "motifs"],
  },
  "persona.bio": {
    label: "Persona bio",
    instruction:
      "Write a short professional bio for this expert: what they do, their credible basis for speaking on it, and how they come across. " +
      "⚠ Invent no credentials, employers, awards or years of experience — use only what is given. If the basis is thin, describe the role rather than embellishing it.",
    maxWords: 80,
    context: ["workspace", "brand"],
  },
  "brand.positioning": {
    label: "Brand positioning",
    instruction:
      "State how this company wants to be understood relative to alternatives: who it is for, and what it stands for.",
    maxWords: 70,
    context: ["workspace", "brand", "motifs"],
  },
  "brand.guardrails": {
    label: "Guardrails",
    instruction:
      "List what the content must never do — claims it cannot make, tones to avoid, subjects off-limits. " +
      "One short rule per line, imperative voice.",
    maxWords: 80,
    context: ["workspace", "brand"],
  },

  // ── Channel setup ─────────────────────────────────────────────────────────
  "audience.description": {
    label: "Audience description",
    instruction:
      "Describe this audience: who they are, what they already know, what they are trying to do, and what frustrates them. " +
      "Grounded in the channel's actual subject, not demographics-by-numbers.",
    maxWords: 90,
    context: ["workspace", "channel"],
  },
  "research.notes": {
    label: "Research notes",
    instruction: "Summarise the research angle: the question being explored and why it matters to this audience.",
    maxWords: 70,
    context: ["channel"],
  },
  "memory.note": {
    label: "Channel memory",
    instruction:
      "Write a durable fact about this channel worth remembering across sessions — a decision, a constraint, or a preference. One or two sentences.",
    maxWords: 40,
    context: ["channel"],
  },
  "template.description": {
    label: "Template description",
    instruction: "Describe what this template is for and when to reach for it.",
    maxWords: 50,
    context: ["channel"],
  },

  // ── Content ───────────────────────────────────────────────────────────────
  "social.post": {
    label: "Post text",
    instruction:
      "Write the post. Lead with the point, no throat-clearing, no hashtag spam. " +
      "Match the brand voice supplied. Do not invent statistics, prices, dates or results.",
    maxWords: 120,
    context: ["workspace", "brand", "motifs"],
  },
  "idea.strategy": {
    label: "Idea strategy",
    instruction: "Explain the hook and the payoff: why someone clicks, and what they get for staying.",
    maxWords: 50,
    context: ["channel"],
  },
  "scene.prompt": {
    label: "Scene prompt",
    instruction:
      "Write a visual prompt for one video scene: subject, setting, camera framing and mood. " +
      "Visual nouns only — no dialogue, no on-screen text instructions.",
    maxWords: 60,
    context: ["channel"],
  },
  "project.brief": {
    label: "Project brief",
    instruction: "Summarise what this project is producing, for whom, and what done looks like.",
    maxWords: 80,
    context: ["workspace", "channel"],
  },
  "wiki.body": {
    label: "Wiki page",
    instruction: "Write a clear internal reference note on this subject. Explain it to a new team member.",
    maxWords: 150,
    context: ["workspace"],
  },
  "asset.description": {
    label: "Asset description",
    instruction: "Describe this asset and when it should be used. One or two sentences.",
    maxWords: 40,
    context: ["workspace"],
  },
  "bookmark.note": {
    label: "Bookmark note",
    instruction: "Note why this is worth keeping and what it might be used for.",
    maxWords: 40,
    context: ["channel"],
  },
} as const satisfies Record<string, AssistField>;

export type AssistFieldKey = keyof typeof ASSIST_FIELDS;

export function isAssistField(key: string): key is AssistFieldKey {
  return Object.hasOwn(ASSIST_FIELDS, key);
}
