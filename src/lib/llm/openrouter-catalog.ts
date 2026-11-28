/**
 * OpenRouter's model list, read the same way everywhere (2026-11-27, the owner's OpenRouter
 * decisions, `meyousocial-knowledge/openrouter-spec.md`). Pure, and import-free, so models.ts,
 * the pickers and scripts can all read it; the fetch and its cache are lib/llm/openrouter.ts.
 *
 * - **Ids.** A Publisher model id for an OpenRouter model is `openrouter:<OpenRouter's id>`
 *   ("openrouter:anthropic/claude-sonnet-5.5"), so a stored choice says which provider runs
 *   it and can never collide with the app's own ids ("claude-sonnet").
 * - **Which models are offered.** Text out only (pictures and video stay on their own
 *   providers) and no `:batch` variants (those are not answered interactively). ⚠ Every
 *   picker in Publisher feeds structured work too — the workspace default and the tiers run
 *   outlines, reviews and idea scoring that parse JSON, and an article's or channel's model
 *   runs those jobs for it — so only a model that can give a structured answer is offered
 *   at all (`canAnswerStructured`). 437 of OpenRouter's 476 models qualified on 2026-11-27.
 * - **The default.** The newest Claude Sonnet in the live list that takes tools — read from
 *   the list, never written down as a guess. `OPENROUTER_FALLBACK_MODEL` is only the answer
 *   while the list can't be read.
 */

export const OPENROUTER_PREFIX = "openrouter:";

export const isOpenRouterModel = (id: string | null | undefined): boolean => Boolean(id && id.startsWith(OPENROUTER_PREFIX) && id.length > OPENROUTER_PREFIX.length);
/** "anthropic/claude-sonnet-5.5" for "openrouter:anthropic/claude-sonnet-5.5". */
export const openrouterSlug = (id: string): string => id.slice(OPENROUTER_PREFIX.length);
export const openrouterModelId = (slug: string): string => `${OPENROUTER_PREFIX}${slug}`;

export type OpenRouterModel = {
  /** OpenRouter's own id, e.g. "anthropic/claude-sonnet-5.5". */
  slug: string;
  name: string;
  /** Unix seconds, as OpenRouter lists it: how "newest" is decided. */
  created: number;
  contextLength: number | null;
  /** USD per million tokens; null when OpenRouter lists no fixed price (a router). */
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  supportedParameters: string[];
  /** The reasoning efforts the model takes ("low", "medium", …); empty when it lists none. */
  supportedEfforts: string[];
};

/** Read from OpenRouter's list on 2026-11-27; the live list decides at run time. */
export const OPENROUTER_FALLBACK_MODEL = "anthropic/claude-sonnet-5.5";

const perMillion = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
};

/** OpenRouter's `GET /models` answer as the models a text call can use. Anything malformed is dropped, not guessed at. */
export function parseOpenRouterModels(raw: unknown): OpenRouterModel[] {
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: OpenRouterModel[] = [];
  for (const m of data as Array<Record<string, unknown>>) {
    const slug = typeof m?.id === "string" ? m.id.trim() : "";
    if (!slug || slug.endsWith(":batch")) continue;
    const arch = m.architecture as { output_modalities?: unknown } | undefined;
    const outputs = arch?.output_modalities;
    if (Array.isArray(outputs) && outputs.some((o) => o !== "text")) continue;
    const pricing = m.pricing as { prompt?: unknown; completion?: unknown } | undefined;
    const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as unknown[]).filter((p): p is string => typeof p === "string") : [];
    const efforts = (m.reasoning as { supported_efforts?: unknown } | undefined)?.supported_efforts;
    out.push({
      slug,
      name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : slug,
      created: Number.isFinite(Number(m.created)) ? Number(m.created) : 0,
      contextLength: Number.isFinite(Number(m.context_length)) && Number(m.context_length) > 0 ? Number(m.context_length) : null,
      promptPerMillion: perMillion(pricing?.prompt),
      completionPerMillion: perMillion(pricing?.completion),
      supportedParameters: params,
      supportedEfforts: Array.isArray(efforts) ? efforts.filter((e): e is string => typeof e === "string") : [],
    });
  }
  return out;
}

/** True for a model that can return a JSON answer: it takes tools, `response_format` or `structured_outputs`. */
export function canAnswerStructured(m: Pick<OpenRouterModel, "supportedParameters">): boolean {
  return m.supportedParameters.some((p) => p === "tools" || p === "response_format" || p === "structured_outputs");
}

/** The newest Claude Sonnet that takes tools, or null when the list has none. A `:suffix` variant is passed over. */
export function defaultOpenRouterModel<T extends Pick<OpenRouterModel, "slug" | "created" | "supportedParameters">>(models: readonly T[]): T | null {
  let best: T | null = null;
  for (const m of models) {
    if (!m.slug.startsWith("anthropic/claude-sonnet") || m.slug.includes(":")) continue;
    if (!m.supportedParameters.includes("tools")) continue;
    if (!best || m.created > best.created) best = m;
  }
  return best;
}

/**
 * What a picker offers: structured-capable models, the default first, then by name.
 * The list is OpenRouter's, so this is the only sorting Publisher adds.
 */
export function pickerModels(models: readonly OpenRouterModel[]): OpenRouterModel[] {
  const def = defaultOpenRouterModel(models);
  const rest = models.filter((m) => canAnswerStructured(m) && m.slug !== def?.slug).sort((a, b) => a.name.localeCompare(b.name));
  return def ? [def, ...rest] : rest;
}

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * The reasoning effort to send: the one asked for when the model takes it, else the nearest
 * it does take — the next one up, or failing that the highest below. No list = send as asked.
 * (Claude Sonnet 5.5 on OpenRouter always reasons, at "high" unless told otherwise.)
 */
export function effortFor(wanted: string, supported: readonly string[]): string {
  if (!supported.length || supported.includes(wanted)) return wanted;
  const at = EFFORTS.indexOf(wanted as (typeof EFFORTS)[number]);
  const known = supported.filter((e) => EFFORTS.includes(e as (typeof EFFORTS)[number]) && e !== "none");
  const up = known.filter((e) => EFFORTS.indexOf(e as (typeof EFFORTS)[number]) >= at).sort((a, b) => EFFORTS.indexOf(a as (typeof EFFORTS)[number]) - EFFORTS.indexOf(b as (typeof EFFORTS)[number]));
  if (up.length) return up[0];
  const down = known.sort((a, b) => EFFORTS.indexOf(b as (typeof EFFORTS)[number]) - EFFORTS.indexOf(a as (typeof EFFORTS)[number]));
  return down[0] ?? wanted;
}

const usd = (n: number): string => (n === 0 ? "$0" : n < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toFixed(2)}`);

/** "$2.00 in · $10.00 out per 1M tokens", "Free", or "Price varies" — OpenRouter's listed price, never an estimate. */
export function priceLabel(m: Pick<OpenRouterModel, "promptPerMillion" | "completionPerMillion">): string {
  if (m.promptPerMillion === null || m.completionPerMillion === null) return "Price varies";
  if (m.promptPerMillion === 0 && m.completionPerMillion === 0) return "Free";
  return `${usd(m.promptPerMillion)} in · ${usd(m.completionPerMillion)} out per 1M tokens`;
}

/** "Anthropic: Claude Sonnet 5.5" → "Claude Sonnet 5.5 (Anthropic)"; a name without a vendor stays as it is. */
export function displayName(name: string): string {
  const i = name.indexOf(": ");
  return i > 0 ? `${name.slice(i + 2)} (${name.slice(0, i)})` : name;
}

/** A readable name from an id alone, for when the list can't be read: "anthropic/claude-sonnet-5.5" → "claude-sonnet-5.5 (anthropic)". */
export function nameFromSlug(slug: string): string {
  const [vendor, ...rest] = slug.split("/");
  return rest.length ? `${rest.join("/")} (${vendor})` : slug;
}

// The last list read on this server, so a synchronous label lookup (models.ts getModel) can
// name a stored OpenRouter choice. Set by lib/llm/openrouter.ts after each successful read.
let known = new Map<string, OpenRouterModel>();

export function rememberOpenRouterModels(models: readonly OpenRouterModel[]): void {
  known = new Map(models.map((m) => [m.slug, m] as const));
}

export function knownOpenRouterModel(slug: string): OpenRouterModel | undefined {
  return known.get(slug);
}
