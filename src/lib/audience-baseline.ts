/**
 * The generic text a new channel's audience profile starts with — written by
 * jobs/onboarding.ts so the Audience page has something to show while (or if)
 * the model's answer fails. ⚠ It is a placeholder, not research about anyone:
 * the same four sentences and five questions on every channel. Kept here, in
 * one place, so the job that writes it and the readers that must NOT mistake
 * it for knowledge (lib/assistant/customer-brief.ts) can't drift apart.
 *
 * Rows written since the `placeholder: true` flag carry the flag; older rows
 * hold the same sentences without it, which is why readers also compare text.
 */
export const AUDIENCE_BASELINE = {
  demographics: (niche: string | null | undefined) => `Adults interested in ${niche ?? "this niche"}.`,
  psychographics: "Curious, growth-oriented, time-poor.",
  onlineBehavior: "YouTube + niche communities; deep-dives.",
  offlineBehavior: "Commute / WFH / weekend project context.",
  keyQuestions: [
    "What's the most efficient way to do this?",
    "Whose advice should I actually trust?",
    "Where do experts disagree, and why?",
    "What do beginners get wrong about this?",
    "How will this look in 3 years?",
  ],
} as const;

export type AudienceSection = "demographics" | "psychographics" | "onlineBehavior" | "offlineBehavior";

/** True when `text` is the setup placeholder for that section, flag or no flag. */
export function isAudienceBaseline(section: AudienceSection, text: string): boolean {
  const t = text.trim();
  if (section === "demographics") return /^Adults interested in [\s\S]+\.$/.test(t);
  return t === AUDIENCE_BASELINE[section];
}

/** True when every question is one of the placeholder five. */
export function areBaselineQuestions(questions: string[]): boolean {
  const base = new Set<string>(AUDIENCE_BASELINE.keyQuestions);
  return questions.length > 0 && questions.every((q) => base.has(q.trim()));
}
