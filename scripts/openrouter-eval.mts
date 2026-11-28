// OpenRouter as a text provider (2026-11-27) — run before any deploy that touches
// src/lib/llm/openrouter*.ts, keys.ts, the router's key/default logic or the meter, against a
// THROWAWAY schema (its name must end in "verify"):
//
//   DATABASE_URL="…?schema=<name>verify" npx tsx scripts/openrouter-eval.mts
//   (npm run eval:openrouter, with DATABASE_URL set the same way)
//
// On the local `npx prisma dev` Postgres add `&pgbouncer=true` to the URL.
//
// Nothing reaches OpenRouter: every request goes to an in-process stand-in for `fetch`, and the
// model list is set by the test. What is checked is what the owner's spec asks the tests to
// cover — the key order (own → share → platform → env), the structured-answer filter, usage and
// cost metering, and the error messages — plus the default model, the request bodies, retries,
// streaming, the platform default and the picker's choices. It makes its own workspaces and
// deletes them after; exit 1 on any failure.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const schema = (() => { try { return new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") ?? ""; } catch { return ""; } })();
if (!schema.endsWith("verify")) {
  console.error(`Refusing to run: DATABASE_URL's schema is "${schema || "(none)"}" — it must be a throwaway whose name ends in "verify".`);
  process.exit(1);
}

const ENV_TIER = process.argv.includes("--env-tier");
// A clean slate: no provider keys from the shell, no mock switch. (The env tier sets its own key below.)
for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_GENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "USE_MOCK_LLM", "DEFAULT_LLM_MODEL"]) delete process.env[k];
if (!ENV_TIER) delete process.env.OPENROUTER_API_KEY;
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("base64");

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; return; }
  failed++;
  console.error(`✗ ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

// ── The stand-in for OpenRouter ─────────────────────────────────────────────
type Scripted = { status: number; body?: unknown; text?: string; headers?: Record<string, string>; sse?: string[] };
const queue: Scripted[] = [];
const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> | null }> = [];
const realFetch = globalThis.fetch;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://openrouter.ai/")) return realFetch(input, init);
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  seen.push({ url, headers, body: init?.body ? JSON.parse(String(init.body)) : null });
  const next = queue.shift() ?? { status: 500, body: { error: { message: "no scripted answer" } } };
  if (next.sse) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({ start(c) { for (const line of next.sse!) c.enqueue(enc.encode(line)); c.close(); } });
    return new Response(stream, { status: next.status, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(next.text ?? JSON.stringify(next.body ?? {}), { status: next.status, headers: { "content-type": "application/json", ...(next.headers ?? {}) } });
};
globalThis.fetch = fakeFetch;

// A model list like OpenRouter's (the shapes read on 2026-11-27).
const RAW_LIST = {
  data: [
    { id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", created: 1790618686, context_length: 1000000, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000002", completion: "0.00001" }, supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs", "tool_choice", "tools"], reasoning: { mandatory: true, supported_efforts: ["max", "xhigh", "high", "medium", "low"] } },
    { id: "anthropic/claude-sonnet-5.5:batch", name: "Anthropic: Claude Sonnet 5.5 (batch)", created: 1790618686, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000005" }, supported_parameters: ["tools"] },
    { id: "anthropic/claude-sonnet-5", name: "Anthropic: Claude Sonnet 5", created: 1782843083, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000002", completion: "0.00001" }, supported_parameters: ["tools", "response_format"] },
    { id: "anthropic/claude-sonnet-6-preview:thinking", name: "Anthropic: Claude Sonnet 6 preview (thinking)", created: 1799999999, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["tools"] },
    { id: "meta-llama/llama-9-70b", name: "Meta: Llama 9 70B", created: 1793000000, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.0000002", completion: "0.0000006" }, supported_parameters: ["temperature", "response_format", "max_tokens"] },
    { id: "tiny/no-structure", name: "Tiny: No Structure", created: 1794000000, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["temperature", "max_tokens"] },
    { id: "google/an-image-model", name: "Google: An Image Model", created: 1795000000, architecture: { output_modalities: ["image", "text"] }, pricing: { prompt: "0.000001", completion: "0.000004" }, supported_parameters: ["tools"] },
    { id: "openrouter/auto", name: "Auto Router", created: 1700000000, architecture: { output_modalities: ["text"] }, pricing: { prompt: "-1", completion: "-1" }, supported_parameters: ["tools"] },
    { name: "missing id" },
  ],
};

// ── The env tier, in its own process (env is read once, at import) ───────────
if (ENV_TIER) {
  const { getApiKey } = await import("../src/lib/llm/keys");
  const v = await getApiKey("openrouter", "no-such-workspace");
  console.log(v === process.env.OPENROUTER_API_KEY ? "ENV_TIER_OK" : `ENV_TIER_BAD ${v ? "(other value)" : "(empty)"}`);
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
  process.exit(0);
}

const catalog = await import("../src/lib/llm/openrouter-catalog");
const or = await import("../src/lib/llm/openrouter");
const { getApiKey } = await import("../src/lib/llm/keys");
const { resolveUsableModel, modelChoices, modelChoiceProblem, llm, inheritedDefault } = await import("../src/lib/llm");
const { refusalKind } = await import("../src/lib/llm/provider-health");
const { setPlatformSetting, setWorkspaceSetting, invalidateSettingsCache, getSetting } = await import("../src/lib/settings");
const { PLATFORM_DEFAULT_MODEL_KEY, getModel } = await import("../src/lib/llm/models");
const { checkKeyFormat } = await import("../src/lib/key-format");
const { db } = await import("../src/lib/db");

const parsed = catalog.parseOpenRouterModels(RAW_LIST);

// ── 1. The list ─────────────────────────────────────────────────────────────
{
  const slugs = parsed.map((m) => m.slug);
  check("list: a :batch variant is dropped", !slugs.includes("anthropic/claude-sonnet-5.5:batch"), slugs);
  check("list: a model with image output is dropped", !slugs.includes("google/an-image-model"), slugs);
  check("list: an entry without an id is dropped", parsed.every((m) => m.slug), slugs);
  check("list: prices per million", parsed.find((m) => m.slug === "anthropic/claude-sonnet-5.5")?.promptPerMillion === 2 && parsed.find((m) => m.slug === "anthropic/claude-sonnet-5.5")?.completionPerMillion === 10);
  check("list: a router's -1 price is no price", parsed.find((m) => m.slug === "openrouter/auto")?.promptPerMillion === null);
  check("list: reasoning efforts read", parsed.find((m) => m.slug === "anthropic/claude-sonnet-5.5")?.supportedEfforts.includes("low") === true);
  check("list: garbage in, nothing out", catalog.parseOpenRouterModels({ nope: 1 }).length === 0 && catalog.parseOpenRouterModels(null).length === 0);
}

// ── 2. The structured-answer filter and the default ─────────────────────────
{
  const by = (s: string) => parsed.find((m) => m.slug === s)!;
  check("structured: tools qualifies", catalog.canAnswerStructured(by("anthropic/claude-sonnet-5")));
  check("structured: response_format alone qualifies", catalog.canAnswerStructured(by("meta-llama/llama-9-70b")));
  check("structured: neither tools nor JSON does not", !catalog.canAnswerStructured(by("tiny/no-structure")));
  const def = catalog.defaultOpenRouterModel(parsed);
  check("default: the newest Claude Sonnet that takes tools, ignoring :suffix variants", def?.slug === "anthropic/claude-sonnet-5.5", def?.slug);
  check("default: none in a list without a Sonnet", catalog.defaultOpenRouterModel(parsed.filter((m) => !m.slug.startsWith("anthropic/"))) === null);
  const picks = catalog.pickerModels(parsed).map((m) => m.slug);
  check("picker: the default first", picks[0] === "anthropic/claude-sonnet-5.5", picks);
  check("picker: non-structured models are not offered", !picks.includes("tiny/no-structure"), picks);
  check("picker: structured ones are", picks.includes("meta-llama/llama-9-70b") && picks.includes("openrouter/auto"), picks);
  check("price label", catalog.priceLabel(by("anthropic/claude-sonnet-5.5")) === "$2.00 in · $10.00 out per 1M tokens" && catalog.priceLabel(by("tiny/no-structure")) === "Free" && catalog.priceLabel(by("openrouter/auto")) === "Price varies");
  check("effort: kept when listed", catalog.effortFor("low", ["low", "medium", "high"]) === "low");
  check("effort: the next one up when not", catalog.effortFor("medium", ["xhigh", "high", "none"]) === "high");
  check("effort: the highest below when nothing is above", catalog.effortFor("max", ["low", "medium"]) === "medium");
  check("effort: no list, sent as asked", catalog.effortFor("low", []) === "low");
  check("ids", catalog.isOpenRouterModel("openrouter:anthropic/claude-sonnet-5.5") && !catalog.isOpenRouterModel("claude-sonnet") && !catalog.isOpenRouterModel("openrouter:") && catalog.openrouterSlug("openrouter:a/b") === "a/b");
  check("key format: sk-or- required", checkKeyFormat("openrouter", "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaa") !== null && checkKeyFormat("openrouter", "sk-or-v1-0123456789abcdef0123456789abcdef") === null);
}

// ── 3. Request bodies and headers (no network) ──────────────────────────────
or.__setOpenRouterModelsForTests(parsed);
{
  const claude = parsed.find((m) => m.slug === "anthropic/claude-sonnet-5.5");
  const short = or.openrouterBody({ model: "openrouter:anthropic/claude-sonnet-5.5", messages: [{ role: "user", content: "hi" }], system: "Be brief.", systemCached: "You are Publisher.", maxTokens: 300, temperature: 0.7 }, false, claude) as Record<string, unknown>;
  check("body: OpenRouter's id", short.model === "anthropic/claude-sonnet-5.5", short.model);
  check("body: one system message, the cached part first", JSON.stringify((short.messages as unknown[])[0]) === JSON.stringify({ role: "system", content: "You are Publisher.\n\nBe brief." }), short.messages);
  check("body: reasoning room added for a reasoning model", short.max_tokens === 300 + 4096, short.max_tokens);
  check("body: a short answer asks for low effort, thinking excluded", JSON.stringify(short.reasoning) === JSON.stringify({ effort: "low", exclude: true }), short.reasoning);
  check("body: no temperature for a model that doesn't list it", !("temperature" in short));
  const llama = or.openrouterBody({ model: "openrouter:meta-llama/llama-9-70b", messages: [{ role: "user", content: "hi" }], maxTokens: 4000, temperature: 0.4 }, true, parsed.find((m) => m.slug === "meta-llama/llama-9-70b")) as Record<string, unknown>;
  check("body: temperature for a model that lists it", llama.temperature === 0.4);
  check("body: no reasoning room or field for a model without reasoning", llama.max_tokens === 4000 && !("reasoning" in llama), llama);
  check("body: stream flag", llama.stream === true && short.stream === false);
  const blind = or.openrouterBody({ model: "openrouter:x/unknown", messages: [{ role: "user", content: "hi" }], temperature: 1 }, false, undefined) as Record<string, unknown>;
  check("body: an unlisted model gets the conservative body", blind.max_tokens === 4096 && !("temperature" in blind) && !("reasoning" in blind), blind);
  const h = or.openrouterHeaders("sk-or-v1-test");
  check("headers: bearer key and the app's name, no person", h.authorization === "Bearer sk-or-v1-test" && h["X-Title"] === "MeYouSocial Publisher" && !JSON.stringify(h).includes("@"), h);
}

// ── 4. The provider against the stand-in: success, usage and cost, errors, retries, streams ──
const provider = or.createOpenRouterProvider("sk-or-v1-eval");
const req = { model: "openrouter:anthropic/claude-sonnet-5.5", messages: [{ role: "user" as const, content: "Say hi" }], maxTokens: 200 };
{
  seen.length = 0;
  queue.push({ status: 200, body: { choices: [{ message: { content: "Hi there." }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 }, cost: 0.000054 } } });
  const out = await provider.complete(req);
  check("complete: the answer", out.content === "Hi there.");
  check("complete: tokens from usage", out.inputTokens === 12 && out.outputTokens === 3 && out.cachedInputTokens === 5, out);
  check("complete: OpenRouter's reported cost", out.costUsd === 0.000054, out.costUsd);
  check("complete: one POST to chat/completions with the key", seen.length === 1 && seen[0].url === or.OPENROUTER_CHAT_URL && seen[0].headers.authorization === "Bearer sk-or-v1-eval", seen.map((s) => s.url));
}
async function failureOf(answers: Scripted[]): Promise<{ message: string; calls: number }> {
  seen.length = 0;
  queue.length = 0;
  queue.push(...answers);
  try { await provider.complete(req); return { message: "(no error)", calls: seen.length }; } catch (e) { return { message: e instanceof Error ? e.message : String(e), calls: seen.length }; }
}
{
  const r401 = await failureOf([{ status: 401, body: { error: { code: 401, message: "User not found." } } }]);
  check("401: says the key is wrong or revoked, with OpenRouter's words", /401/.test(r401.message) && /wrong or has been revoked/.test(r401.message) && r401.message.includes("User not found."), r401.message);
  check("401: the Inbox reads it as the key", refusalKind(r401.message) === "key", refusalKind(r401.message));
  check("401: not retried", r401.calls === 1, r401.calls);
  const r402 = await failureOf([{ status: 402, body: { error: { code: 402, message: "Insufficient credits" } } }]);
  check("402: out of credit, with OpenRouter's words", /out of credit/.test(r402.message) && r402.message.includes("Insufficient credits"), r402.message);
  check("402: the Inbox reads it as credits", refusalKind(r402.message) === "credits", refusalKind(r402.message));
  const r429 = await failureOf([0, 1, 2].map(() => ({ status: 429, body: { error: { message: "Rate limit exceeded" } }, headers: { "retry-after": "0" } })));
  check("429: retried twice, then said", r429.calls === 3 && /rate limiting/.test(r429.message), r429);
  check("429: the Inbox reads it as a rate limit", refusalKind(r429.message) === "quota", refusalKind(r429.message));
  const r404 = await failureOf([{ status: 404, body: { error: { message: "No endpoints found for x/y." } } }]);
  check("404: the Inbox reads it as the model", refusalKind(r404.message) === "model", r404.message);
  const r403 = await failureOf([{ status: 403, body: { error: { message: "Input flagged by moderation", metadata: { reasons: ["x"] } } } }]);
  check("403: moderation, never read as the key", refusalKind(r403.message) === null && /moderation/.test(r403.message), r403.message);
  const r5xx = await failureOf([{ status: 502, body: { error: { message: "upstream down" } }, headers: { "retry-after": "0" } }, { status: 200, body: { choices: [{ message: { content: "Recovered." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }]);
  check("5xx: transient, retried, then answered", r5xx.message === "(no error)" && r5xx.calls === 2, r5xx);
  const inner = await failureOf([{ status: 200, body: { error: { code: 502, message: "Provider returned error", metadata: { raw: "overloaded", provider_name: "Anthropic" } } } }]);
  check("an error inside a 200 is an error, with the provider's answer", /Provider returned error \(Anthropic\): overloaded/.test(inner.message), inner.message);
  const empty = await failureOf([{ status: 200, body: { choices: [{ message: { content: "" }, finish_reason: "length" }] } }]);
  check("an empty answer is an error, and not a refusal", /ran out of room/.test(empty.message) && refusalKind(empty.message) === null, empty.message);
}
{
  queue.length = 0;
  queue.push({ status: 200, sse: [": OPENROUTER PROCESSING\n\n", "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n", "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n", "\ndata: [DONE]\n\n"] });
  let text = "";
  for await (const piece of provider.stream(req)) text += piece;
  check("stream: deltas joined, comment lines skipped", text === "Hello", text);
  queue.push({ status: 200, sse: ["data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n", "data: {\"error\":{\"code\":402,\"message\":\"Insufficient credits\"}}\n"] });
  let streamErr = "";
  try { for await (const _ of provider.stream(req)) { /* drain */ } } catch (e) { streamErr = e instanceof Error ? e.message : String(e); }
  check("stream: an error mid-stream is thrown in words", refusalKind(streamErr) === "credits", streamErr);
}
{
  queue.length = 0;
  queue.push({ status: 200, body: { data: { limit: 10, limit_remaining: 4.2, usage: 5.8, is_free_tier: false } } });
  const info = await or.checkOpenRouterKey("sk-or-v1-eval");
  check("key check: credit left", or.describeKeyCheck(info) === "Valid — $4.20 of $10.00 credit left on this key.", or.describeKeyCheck(info));
  check("key check: no limit", or.describeKeyCheck({ limit: null, limitRemaining: null, usage: 1, isFreeTier: false }) === "Valid — no credit limit is set on this key.");
  queue.push({ status: 401, body: { error: { message: "User not found." } } });
  let status = 0;
  try { await or.checkOpenRouterKey("sk-or-v1-bad"); } catch (e) { status = (e as { status?: number }).status ?? -1; }
  check("key check: a refused key throws its status", status === 401, status);
  check("key check: the request went to /key", seen.at(-1)?.url === or.OPENROUTER_KEY_URL || queue.length === 0);
}

// ── 5. The key order and the platform default, on the throwaway database ────
const tag = randomBytes(4).toString("hex");
const made: string[] = [];
const ws = async (name: string) => { const w = await db.workspace.create({ data: { name: `OR eval ${name} ${tag}` } }); made.push(w.id); return w.id; };
const reset = () => { invalidateSettingsCache(); };
try {
  await setPlatformSetting("api_key:openrouter", "");
  await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "");
  const A = await ws("A"), B = await ws("B"), C = await ws("C");
  reset();
  check("order: nothing anywhere → no key", (await getApiKey("openrouter", C)) === "");

  // The env tier, in a child process (env is read once, at import) — while no row exists, since every row comes before it.
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, ["--import", "tsx", self, "--env-tier"], { env: { ...process.env, OPENROUTER_API_KEY: "sk-or-v1-from-env-00000000000000000000" }, encoding: "utf8" });
  check("order: with no rows at all, the server's environment", /ENV_TIER_OK/.test(child.stdout ?? ""), (child.stdout || child.stderr || "").slice(-300));

  await setWorkspaceSetting(A, "api_key:openrouter", "sk-or-v1-own-of-A-000000000000000000");
  await setPlatformSetting("api_key:openrouter", "sk-or-v1-platform-0000000000000000000");
  reset();
  check("order: the workspace's own key first", (await getApiKey("openrouter", A)) === "sk-or-v1-own-of-A-000000000000000000");
  check("order: without one, the platform's shared key", (await getApiKey("openrouter", B)) === "sk-or-v1-platform-0000000000000000000");
  await db.keyShare.create({ data: { key: "api_key:openrouter", fromWorkspaceId: A, toWorkspaceId: B } });
  reset();
  check("order: a key another workspace shares comes before the platform's", (await getApiKey("openrouter", B)) === "sk-or-v1-own-of-A-000000000000000000");
  // Raw SQL skips the db layer's opening of sealed values, so this sees what is really stored.
  const raw = await db.$queryRawUnsafe<Array<{ value: string }>>(`SELECT value FROM "WorkspaceSetting" WHERE "workspaceId" = $1 AND key = 'api_key:openrouter'`, A);
  const { isSealedSetting } = await import("../src/lib/keyring");
  check("at rest: the key is sealed, not stored as typed", raw.length === 1 && raw[0].value !== "sk-or-v1-own-of-A-000000000000000000" && isSealedSetting(raw[0].value), raw[0]?.value.slice(0, 12));

  // Picker choices.
  const choicesC = await modelChoices(C);
  check("picker: OpenRouter's models appear where a key resolves (the platform's)", choicesC.some((m) => m.provider === "openrouter"), choicesC.length);
  const orChoices = choicesC.filter((m) => m.provider === "openrouter");
  check("picker: default first, non-structured left out, each with its price", orChoices[0]?.id === "openrouter:anthropic/claude-sonnet-5.5" && !orChoices.some((m) => m.id.endsWith("tiny/no-structure")) && orChoices[0].style.includes("per 1M tokens"), orChoices.slice(0, 2));
  check("label: from the list", getModel("openrouter:anthropic/claude-sonnet-5.5")?.label === "Claude Sonnet 5.5 (Anthropic) via OpenRouter", getModel("openrouter:anthropic/claude-sonnet-5.5")?.label);

  // Choice checks.
  check("choice: a listed structured model is fine", (await modelChoiceProblem("openrouter:meta-llama/llama-9-70b", C, null)) === null);
  check("choice: one OpenRouter doesn't list is refused", /doesn't list/.test((await modelChoiceProblem("openrouter:gone/model", C, null)) ?? ""));
  check("choice: one that can't answer in structure is refused", /structured answers/.test((await modelChoiceProblem("openrouter:tiny/no-structure", C, null)) ?? ""));
  or.__setOpenRouterModelsForTests(null, "offline");
  check("choice: while the list can't be read, accepted", (await modelChoiceProblem("openrouter:anything/at-all", C, null)) === null);
  or.__setOpenRouterModelsForTests(parsed);

  // The platform default.
  const D = await ws("D-no-key"), E = await ws("E-own-anthropic");
  await setWorkspaceSetting(E, "api_key:anthropic", "sk-ant-api03-eval-0000000000000000000000000");
  reset();
  check("default: stays on today's default until switched", (await inheritedDefault(D)) === "claude-sonnet");
  check("default: the shared key never takes over by itself — no key for today's default stays a labelled placeholder", (await resolveUsableModel("", D)) === "claude-sonnet", await resolveUsableModel("", D));
  const F = await ws("F-own-openrouter");
  await setWorkspaceSetting(F, "api_key:openrouter", "sk-or-v1-own-of-F-000000000000000000");
  reset();
  check("default: a workspace with its OWN OpenRouter key and nothing else falls back to OpenRouter's default", (await resolveUsableModel("", F)) === "openrouter:anthropic/claude-sonnet-5.5", await resolveUsableModel("", F));
  await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "openrouter:meta-llama/llama-9-70b");
  reset();
  check("default: switched — a workspace with no model or key gets it", (await resolveUsableModel("", D)) === "openrouter:meta-llama/llama-9-70b", await resolveUsableModel("", D));
  check("default: a workspace with its own Anthropic key keeps writing on it", (await resolveUsableModel("", E)) === "claude-sonnet", await resolveUsableModel("", E));
  await db.workspace.update({ where: { id: D }, data: { defaultModel: "openrouter:anthropic/claude-sonnet-5" } });
  check("default: a workspace's own choice wins", (await resolveUsableModel("", D)) === "openrouter:anthropic/claude-sonnet-5");
  check("default: a stored light-only platform default is ignored", await (async () => { await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "deepseek-flash"); reset(); return (await inheritedDefault(C)) === "claude-sonnet"; })());
  await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "");

  // Through the router: metering, cost, and the refusal record.
  reset();
  queue.length = 0;
  queue.push({ status: 200, body: { choices: [{ message: { content: "Metered." } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.00042 } } });
  const out = await llm.complete({ model: "openrouter:anthropic/claude-sonnet-5.5", messages: [{ role: "user", content: "x" }], workspaceId: C, purpose: "assist", maxTokens: 100 });
  check("router: OpenRouter answered", out.provider === "openrouter" && out.content === "Metered.", out);
  const row = await db.usageLog.findFirst({ where: { workspaceId: C, action: "ai.text" }, orderBy: { createdAt: "desc" } });
  check("meter: one row with provider, model, tokens and purpose", row?.provider === "openrouter" && row?.model === "openrouter:anthropic/claude-sonnet-5.5" && row?.inputTokens === 100 && row?.outputTokens === 20 && row?.tokens === 120 && row?.purpose === "assist", row);
  check("meter: OpenRouter's cost in millionths of a dollar", row?.costMicros === 420, row?.costMicros);
  queue.push({ status: 402, body: { error: { message: "Insufficient credits" } } });
  const fell = await llm.complete({ model: "openrouter:anthropic/claude-sonnet-5.5", messages: [{ role: "user", content: "x" }], workspaceId: C, purpose: "assist", maxTokens: 100 });
  check("router: a refusal falls back to the labelled placeholder", fell.provider === "mock", fell.provider);
  const mockRow = await db.usageLog.findFirst({ where: { workspaceId: C, action: "ai.text" }, orderBy: { createdAt: "desc" } });
  check("meter: the placeholder's row carries no cost", mockRow?.provider === "mock" && mockRow?.costMicros === null, mockRow);
  reset();
  const refusal = JSON.parse((await getSetting("llm:refusal:openrouter", C)) || "null") as { kind?: string; message?: string } | null;
  check("inbox: the refusal is recorded as credits, in OpenRouter's words", refusal?.kind === "credits" && (refusal?.message ?? "").includes("Insufficient credits"), refusal);
  check("inbox: the key never reaches the record", !(refusal?.message ?? "").includes("sk-or-"), refusal?.message);
} finally {
  await db.keyShare.deleteMany({ where: { OR: [{ fromWorkspaceId: { in: made } }, { toWorkspaceId: { in: made } }] } }).catch(() => {});
  await db.workspace.deleteMany({ where: { id: { in: made } } }).catch(() => {});
  await setPlatformSetting("api_key:openrouter", "").catch(() => {});
  await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "").catch(() => {});
  await db.$disconnect();
}

globalThis.fetch = realFetch;
console.log(`${failed ? "✗" : "✓"} openrouter eval: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
