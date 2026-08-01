/**
 * Shape checks for pasted API keys.
 *
 * Why this exists: on 2026-07-31 a workspace had a **URL** sitting in its
 * ElevenLabs key field, saved without complaint, with `tts:provider` pointed at
 * it. Nothing surfaced until a voiceover render failed much later with an
 * unrelated-looking error. A key field that accepts anything is a trap, because
 * the cost of the mistake is paid minutes or days away from the paste.
 *
 * ⚠ DELIBERATELY CONSERVATIVE. A false rejection is worse than a false accept:
 * it stops someone using a key that would have worked, and there is no override.
 * So a prefix is only enforced where the vendor's format is genuinely stable.
 *
 * ⚠ Google is the reason for that caution, not an oversight. Gemini keys are
 * widely documented as starting `AIza`, and the key in live use on this install
 * starts `AQ.` — a real, working key that a strict `AIza` check would have
 * refused. Google therefore gets the universal checks only.
 */

export type KeyFormatProblem = { reason: string; hint?: string };

/** Vendors whose prefix is stable enough to reject on. */
const EXPECTED_PREFIX: Record<string, { prefix: string; label: string }> = {
  anthropic:  { prefix: "sk-ant-", label: "Anthropic keys start with \"sk-ant-\"" },
  openai:     { prefix: "sk-",     label: "OpenAI keys start with \"sk-\"" },
  deepseek:   { prefix: "sk-",     label: "DeepSeek keys start with \"sk-\"" },
  xai:        { prefix: "xai-",    label: "xAI keys start with \"xai-\"" },
  elevenlabs: { prefix: "sk_",     label: "ElevenLabs keys start with \"sk_\"" },
  tavily:     { prefix: "tvly-",   label: "Tavily keys start with \"tvly-\"" },
  // Not listed, on purpose: google / youtube (AIza and AQ. both occur),
  // moonshot, minimax, heygen, serper — no format stable enough to refuse on.
};

/**
 * Returns a problem to show the user, or null when the value looks plausible.
 * An EMPTY value is always fine — that is how a key is cleared.
 */
export function checkKeyFormat(provider: string, value: string): KeyFormatProblem | null {
  if (!value) return null;

  // Universal red flags. These are not vendor-specific guesses — no API key of
  // any vendor is a URL, and none contains whitespace.
  if (/^https?:\/\//i.test(value)) {
    return {
      reason: "That's a URL, not an API key.",
      hint: "It looks like a link from the provider's dashboard was pasted instead of the key itself.",
    };
  }
  if (/\s/.test(value)) {
    return {
      reason: "That contains a space or line break, which no API key does.",
      hint: "Copying from a PDF or an email often drags in a trailing newline — retry the copy.",
    };
  }
  if (value.includes("@") && !value.startsWith("sk")) {
    return { reason: "That looks like an email address, not an API key." };
  }
  // Long enough to be a credential. The shortest real key seen on this install
  // is 39 characters (a Google Data API key); 20 leaves generous headroom.
  if (value.length < 20) {
    return {
      reason: `That's only ${value.length} characters — too short to be an API key.`,
      hint: "Check the whole value was copied, not just the visible part of a truncated field.",
    };
  }

  const expected = EXPECTED_PREFIX[provider];
  if (expected && !value.startsWith(expected.prefix)) {
    return {
      reason: `${expected.label}, and this one starts "${value.slice(0, 6)}…".`,
      hint: "If the vendor has changed their format, paste it into the env var instead and this check can be relaxed.",
    };
  }

  return null;
}

/** Message for the banner. ⚠ `err` on /admin/api-keys renders VERBATIM (unlike
 *  `ok`, which carries a token the page wraps in its own copy), so this must be
 *  a complete, readable sentence. */
export function keyFormatMessage(provider: string, problem: KeyFormatProblem): string {
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${label} key not saved. ${problem.reason}${problem.hint ? ` ${problem.hint}` : ""}`;
}
