import { db } from "@/lib/db";

/**
 * FR-3 — SME knowledge profiles.
 *
 * The old process was a ten-question interview per article, which produced good
 * writing and could not be delegated. This captures the same ground once per
 * expert and replays it into every draft, so a piece answers as the expert
 * would rather than as a competent generalist.
 *
 * The "never say" list is the sharp edge: it goes into prompts as a hard rule
 * alongside the truthfulness guardrails, because an expert's reputation is what
 * the draft is borrowing.
 */

export type IntakeQuestion = {
  id: string;
  question: string;
  /** What a good answer contains — shown under the field, and used when an
   *  answer is drafted from existing source material. */
  hint: string;
  rows: number;
};

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    id: "practice",
    question: "What do you actually do, and for whom?",
    hint: "The work itself and the kind of client — specific enough that a reader recognises themselves.",
    rows: 3,
  },
  {
    id: "experience",
    question: "What experience qualifies you to speak on this?",
    hint: "Years, roles, the scale of work handled. Facts a reader could check, not adjectives.",
    rows: 3,
  },
  {
    id: "credentials",
    question: "What credentials or certifications should we cite?",
    hint: "Licences, accreditations, memberships, published work. Only ones that genuinely exist.",
    rows: 2,
  },
  {
    id: "misconceptions",
    question: "What do most people get wrong about your field?",
    hint: "The belief you find yourself correcting most often, and what's true instead.",
    rows: 3,
  },
  {
    id: "opinions",
    question: "What do you believe that others in your field don't?",
    hint: "The genuinely contested view. This is what makes a draft sound like you and not like everyone.",
    rows: 3,
  },
  {
    id: "cases",
    question: "Walk through a representative piece of work.",
    hint: "Situation, what you did, what happened. Include only outcomes you can stand behind if quoted.",
    rows: 5,
  },
  {
    id: "questions",
    question: "What do clients ask you most often?",
    hint: "Their words, not the polished version. These become article topics and FAQ sections.",
    rows: 3,
  },
  {
    id: "always",
    question: "What do you always recommend?",
    hint: "The advice you give nearly every time, and the reason behind it.",
    rows: 3,
  },
  {
    id: "never",
    question: "What do you never recommend, and why?",
    hint: "The approaches you steer clients away from. The 'why' matters more than the 'what'.",
    rows: 3,
  },
  {
    id: "explanations",
    question: "What examples or analogies do you use to explain your work?",
    hint: "The explanation that makes people finally get it. Reusable in drafts.",
    rows: 3,
  },
];

export const INTAKE_IDS = INTAKE_QUESTIONS.map((q) => q.id);

export type IntakeAnswers = Record<string, string>;

export function parseAnswers(json: string | null | undefined): IntakeAnswers {
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return {};
    const out: IntakeAnswers = {};
    for (const q of INTAKE_QUESTIONS) {
      const v = (raw as Record<string, unknown>)[q.id];
      if (typeof v === "string" && v.trim()) out[q.id] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function readAnswers(formData: FormData): IntakeAnswers {
  const out: IntakeAnswers = {};
  for (const q of INTAKE_QUESTIONS) {
    const v = String(formData.get(`answer_${q.id}`) ?? "").trim();
    if (v) out[q.id] = v.slice(0, 4000);
  }
  return out;
}

/** How complete a profile is — the list shows this so gaps are visible. */
export function completeness(answers: IntakeAnswers): { answered: number; total: number } {
  return { answered: INTAKE_QUESTIONS.filter((q) => answers[q.id]).length, total: INTAKE_QUESTIONS.length };
}

export function parseTopics(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : [];
  } catch {
    return [];
  }
}

// ---- Selection ------------------------------------------------------------------

type ProfileRow = {
  id: string;
  name: string;
  role: string | null;
  credentials: string | null;
  bio: string | null;
  answers: string;
  alwaysSay: string | null;
  neverSay: string | null;
  topics: string;
};

const WORD = /[a-z0-9]+/g;

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 3));
}

/**
 * Pick the expert for a post: the explicit choice, else the best topic match,
 * else — when only one active expert exists — that one. No match returns null
 * rather than guessing, so a draft is never attributed to the wrong person.
 */
export async function selectSmeProfile(
  workspaceId: string,
  post: { smeProfileId?: string | null; title?: string; focusKeyword?: string | null; audience?: string | null },
): Promise<ProfileRow | null> {
  const profiles = await db.smeProfile.findMany({ where: { workspaceId, status: "active" } });
  if (!profiles.length) return null;
  if (post.smeProfileId) {
    const chosen = profiles.find((p) => p.id === post.smeProfileId);
    if (chosen) return chosen;
  }

  const haystack = tokens([post.title ?? "", post.focusKeyword ?? "", post.audience ?? ""].join(" "));
  if (haystack.size) {
    let best: { profile: ProfileRow; score: number } | null = null;
    for (const p of profiles) {
      const topicWords = tokens(parseTopics(p.topics).join(" "));
      let score = 0;
      for (const t of topicWords) if (haystack.has(t)) score++;
      if (score > 0 && (!best || score > best.score)) best = { profile: p, score };
    }
    if (best) return best.profile;
  }
  return profiles.length === 1 ? profiles[0] : null;
}

/** The grounding block. Long-form: everything the expert gave us. */
export function smeBlock(profile: ProfileRow): string {
  const answers = parseAnswers(profile.answers);
  const lines: string[] = [
    `Write as ${profile.name}${profile.role ? `, ${profile.role}` : ""} would answer — their expertise, their opinions, their examples.`,
  ];
  if (profile.credentials) lines.push(`Credentials that may be cited: ${profile.credentials}`);
  if (profile.bio) lines.push(`Background: ${profile.bio}`);
  for (const q of INTAKE_QUESTIONS) {
    const a = answers[q.id];
    if (a) lines.push(`${q.question}\n${a.slice(0, 1200)}`);
  }
  if (profile.alwaysSay) lines.push(`Always reflect this guidance: ${profile.alwaysSay}`);
  if (profile.neverSay) {
    lines.push(
      `HARD RULE — never write any of the following, in any form, however it is phrased: ${profile.neverSay}`,
    );
  }
  lines.push(
    "Use only the expertise above. Where the article needs a fact this expert did not supply, do not invent it on their behalf — flag it [NEEDS SOURCE].",
  );
  return `Subject-matter expert grounding:\n${lines.join("\n\n")}`;
}

/** Short form for titles, outlines, and other cheap generations. */
export function smeBlockShort(profile: ProfileRow): string {
  const answers = parseAnswers(profile.answers);
  const parts = [
    `Speaking as ${profile.name}${profile.role ? `, ${profile.role}` : ""}.`,
    answers.opinions ? `Their distinctive view: ${answers.opinions.slice(0, 300)}` : null,
    profile.neverSay ? `Never say: ${profile.neverSay.slice(0, 200)}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

/** Resolve + render in one call; null when no expert applies. */
export async function smePromptFor(
  workspaceId: string,
  post: { smeProfileId?: string | null; title?: string; focusKeyword?: string | null; audience?: string | null },
  variant: "full" | "short" = "full",
): Promise<string | null> {
  const profile = await selectSmeProfile(workspaceId, post);
  if (!profile) return null;
  return variant === "full" ? smeBlock(profile) : smeBlockShort(profile);
}
