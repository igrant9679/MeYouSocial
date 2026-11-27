import { getSetting } from "@/lib/settings";
import { TEMPLATE_PARTS, type TemplatePart } from "@/lib/workspace-template";

// The free trial's rules (2026-11-26, the owner's "14-day trial"): Publisher's own sign-up page
// gives anyone a workspace on MeYouSocial's AI keys for a number of days, with an AI allowance.
// All platform settings, set by the operator on Settings → Sign-ups. A blank setting is the
// default; "0" days turns the trial door off (sign-up is then by invitation, as before).
// Trials ship OFF (the owner's "push it with trials off", 2026-11-26): the door opens only when
// the operator enters a number of days on Sign-ups. 14 is the length the owner chose.

export const SIGNUP_KEYS = {
  trialDays: "signup:trial_days",
  tokenCap: "signup:trial_token_cap",
  imageCap: "signup:trial_image_cap",
  maxOpen: "signup:trial_max_open",
  membershipUrl: "signup:membership_url",
  templateId: "signup:template_id",
  templateParts: "signup:template_parts",
} as const;

/** The trial length the owner chose; shown as the suggestion while trials are off. */
export const TRIAL_SUGGESTED_DAYS = 14;

export const TRIAL_DEFAULTS = {
  /** 0 = trials off until the operator sets the days on Sign-ups. */
  days: 0,
  /** AI text tokens over the whole trial (input + output). */
  tokenCap: 1_000_000,
  /** Generated pictures over the whole trial. */
  imageCap: 30,
  /** Trials running at once, across the install — a brake on sign-up floods. */
  maxOpen: 25,
  /** Where a trial (or a lapsed member) is sent to become a member. */
  membershipUrl: "https://www.meyousocial.com/membership/",
} as const;

export const TRIAL_LIMITS = { days: 90, tokenCap: 100_000_000, imageCap: 10_000, maxOpen: 10_000 } as const;

export type TrialPolicy = {
  days: number;
  tokenCap: number;
  imageCap: number;
  maxOpen: number;
  membershipUrl: string;
  templateId: string | null;
  templateParts: TemplatePart[];
};

/** A stored whole number, or `fallback` when blank or unreadable; clamped to 0…max. */
export function readCount(raw: string, fallback: number, max: number): number {
  const t = raw.trim();
  if (!t) return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(n)));
}

/** The template parts a new workspace copies: blank = all of them, "none" = none. */
export function readParts(raw: string): TemplatePart[] {
  const t = raw.trim();
  if (!t) return [...TEMPLATE_PARTS];
  const wanted = new Set(t.split(",").map((s) => s.trim()));
  return TEMPLATE_PARTS.filter((p) => wanted.has(p));
}

/** An http(s) address, or the default. */
export function readUrl(raw: string, fallback: string): string {
  const t = raw.trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : fallback;
}

export async function trialPolicy(): Promise<TrialPolicy> {
  const [days, tokenCap, imageCap, maxOpen, membershipUrl, templateId, templateParts] = await Promise.all(
    [
      SIGNUP_KEYS.trialDays,
      SIGNUP_KEYS.tokenCap,
      SIGNUP_KEYS.imageCap,
      SIGNUP_KEYS.maxOpen,
      SIGNUP_KEYS.membershipUrl,
      SIGNUP_KEYS.templateId,
      SIGNUP_KEYS.templateParts,
    ].map((k) => getSetting(k).catch(() => "")),
  );
  return {
    days: readCount(days, TRIAL_DEFAULTS.days, TRIAL_LIMITS.days),
    tokenCap: readCount(tokenCap, TRIAL_DEFAULTS.tokenCap, TRIAL_LIMITS.tokenCap),
    imageCap: readCount(imageCap, TRIAL_DEFAULTS.imageCap, TRIAL_LIMITS.imageCap),
    maxOpen: readCount(maxOpen, TRIAL_DEFAULTS.maxOpen, TRIAL_LIMITS.maxOpen),
    membershipUrl: readUrl(membershipUrl, TRIAL_DEFAULTS.membershipUrl),
    templateId: templateId.trim() || null,
    templateParts: readParts(templateParts),
  };
}
