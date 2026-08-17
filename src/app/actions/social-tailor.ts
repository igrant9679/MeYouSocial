"use server";

import { requireRole } from "@/lib/acl";
import { llm, resolveUsableModel } from "@/lib/llm";
import { motifPromptFor, brandContextBlock } from "@/lib/motifs";
import { networkFor } from "@/lib/social/networks";

/**
 * Rewrite one base post into per-network variants.
 *
 * ⚠ The client sends PROVIDER SLUGS and the base text, never a prompt — the
 * same key-not-prompt rule assist follows, so a browser can't spend the
 * workspace's LLM budget on arbitrary instructions.
 *
 * ⚠ PROPOSES, never applies. The composer shows each variant with Use it /
 * Discard; nothing overwrites the author's text until they accept.
 *
 * ⚠ Mock output is REFUSED, not returned. Unattended placeholder prose in a
 * real feed is the cardinal failure this app keeps re-learning — and mock
 * prose reads fluently, so the only safe move is to say the model wasn't
 * reachable.
 *
 * "If necessary" is enforced honestly: a network whose conventions and limit
 * the base text already satisfies is reported as `skipped` rather than being
 * given a pointless variant.
 */

export type TailorResult =
  | { ok: true; variants: Record<string, string>; skipped: string[]; provider: string; stillOver: string[] }
  | { ok: false; error: string };

/** House style per network — facts about the medium, not opinions about the brand. */
const NETWORK_STYLE: Record<string, string> = {
  twitter: "punchy and conversational; one idea; no hashtag spam (0-2 at most); a hook in the first line",
  linkedin: "professional and substantive; a clear insight or takeaway; first line works as a hook because the rest is hidden behind 'see more'; 0-3 hashtags",
  facebook: "warm and plain-spoken; a little more room to explain; a question or invitation to reply reads well; 0-2 hashtags",
  instagram: "visual-first caption written to sit under an image; friendly, concrete; line breaks for scannability; 3-8 relevant hashtags at the end",
  threads: "casual and brief, like a conversation opener",
  bluesky: "concise and plain; no hashtag padding",
  tiktok: "spoken-word energy, very short, hook first",
  pinterest: "descriptive and keyword-rich; describes what the image shows",
  reddit: "plainly informative, no marketing voice, no hashtags — reads as a person sharing something",
  youtube: "describes the video; front-loads what the viewer gets",
  googlebusiness: "practical and local; a clear call to action",
  telegram: "direct and informative",
  whatsapp: "short and personal",
  discord: "casual, community voice",
  snapchat: "very short and playful",
};

export async function tailorPostForNetworksAction(input: {
  text: string;
  /** Zernio platform slugs (lowercase) of the selected accounts. */
  providers: string[];
  /** Optional bounded steering, same softening as assist guidance. */
  guidance?: string;
}): Promise<TailorResult> {
  const { workspace } = await requireRole("EDITOR");

  const text = String(input.text ?? "").trim();
  if (text.length < 20) {
    return { ok: false, error: "Write the base post first — tailoring rewrites what you've written." };
  }

  const providers = [...new Set((input.providers ?? []).map((p) => String(p).toLowerCase()))]
    .filter((p) => networkFor(p))
    .slice(0, 10);
  if (providers.length === 0) return { ok: false, error: "Pick at least one network first." };

  // Only rewrite what actually needs it: over the limit, or a network whose
  // conventions differ enough to be worth a pass. A network the base already
  // suits keeps the base — that's what "if necessary" means.
  const needsWork = providers.filter((p) => {
    const net = networkFor(p)!;
    if (text.length > net.charLimit) return true;
    // Instagram/Pinterest/Reddit/TikTok read badly in a generic voice even when
    // they fit; the rest are close enough to the base to leave alone.
    return ["instagram", "pinterest", "reddit", "tiktok", "threads", "snapchat"].includes(p);
  });
  const skipped = providers.filter((p) => !needsWork.includes(p));
  if (needsWork.length === 0) {
    return { ok: true, variants: {}, skipped, provider: "none", stillOver: [] };
  }

  const [motifs, guardrails] = await Promise.all([
    motifPromptFor(workspace.id, {}, "short").catch(() => null),
    brandContextBlock(workspace.id).catch(() => null),
  ]);
  const guidance = String(input.guidance ?? "").trim().slice(0, 300);

  const system =
    "You adapt one social media post for different networks. You rewrite for the medium — length, voice, hashtag conventions — " +
    "and you never change the facts, the offer, the links or the claims. " +
    "⚠ Never invent specifics: no numbers, dates, names, prices or credentials that are not in the base post. " +
    "Return ONLY a JSON object mapping each requested network key to its post text. No commentary, no markdown fences.";

  const spec = needsWork
    .map((p) => {
      const net = networkFor(p)!;
      return `- "${p}": ${NETWORK_STYLE[p] ?? "clear and natural for this network"}. HARD LIMIT ${net.charLimit} characters (stay comfortably under it).`;
    })
    .join("\n");

  const prompt = [
    `Base post:\n"""\n${text.slice(0, 4000)}\n"""`,
    motifs ? `Brand tone:\n${motifs}` : "",
    guardrails ?? "",
    `Write one version for each of these networks:\n${spec}`,
    guidance ? `The author's instructions — follow them within the rules above:\n${guidance}` : "",
    `Return JSON only, exactly: { ${needsWork.map((p) => `"${p}": "…"`).join(", ")} }`,
  ].filter(Boolean).join("\n\n");

  try {
    const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, workspace.id);
    const res = await llm.complete({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      workspaceId: workspace.id,
      temperature: 0.7,
      // Room for several variants PLUS a reasoning model's thinking budget —
      // the gemini cushion lesson: a tight cap returns empty text.
      maxTokens: 2000,
    });

    const provider = res.provider ?? "unknown";
    if (provider === "mock") {
      return { ok: false, error: "The model wasn't reachable, so no variants were written (placeholder text is never used here)." };
    }

    const parsed = parseVariants(res.content, needsWork);
    if (Object.keys(parsed).length === 0) {
      return { ok: false, error: "The model didn't return usable variants. Try again." };
    }

    // Verify rather than trust: a variant still over the limit is reported, not
    // silently truncated — cutting someone's post mid-sentence is worse than
    // telling them it needs another pass.
    const stillOver = Object.entries(parsed)
      .filter(([p, v]) => v.length > (networkFor(p)?.charLimit ?? 3000))
      .map(([p]) => p);

    return { ok: true, variants: parsed, skipped, provider, stillOver };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Tailoring failed." };
  }
}

/** Pull the JSON object out of a model reply that may still be wrapped. */
function parseVariants(raw: string, wanted: string[]): Record<string, string> {
  const cleaned = (raw ?? "").trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (!wanted.includes(key)) continue;
    const value = typeof v === "string" ? v.trim() : "";
    if (value) out[key] = value;
  }
  return out;
}
