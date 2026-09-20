"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { setWorkspaceSetting } from "@/lib/settings";
import { isSearchDataCountry, searchDataVendorLabel } from "@/lib/search-data";
import { keywordCountry, syncKeywordVolumes, syncNewPhrases } from "@/lib/keyword-volumes";
import { stripListMarker } from "@/lib/list-marker";

/**
 * Keyword strategy (Wave A′). Honesty rule: tier is editorial priority (1 head
 * … 4 long-tail), intent and clusters are LLM-classified and the UI says so.
 * Volume / CPC / competition come ONLY from a real search-data provider
 * (lib/search-data: DataForSEO or Keywords Everywhere, via
 * lib/keyword-volumes) — with no key they stay null and render as a dash with
 * the reason. Nothing here invents a number.
 */

/** The Refresh button: optionally records the country, then syncs every active keyword. */
export async function refreshKeywordVolumesAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const country = String(formData.get("country") ?? "").trim().toLowerCase();
  if (country && isSearchDataCountry(country) && country !== (await keywordCountry(workspace.id))) {
    await setWorkspaceSetting(workspace.id, "keywords:country", country);
  }
  const res = await syncKeywordVolumes(workspace.id);
  revalidatePath("/blog/keywords");
  if (res.ok) {
    redirect(`/blog/keywords?ok=${encodeURIComponent(`${searchDataVendorLabel(res.vendor)} returned volumes for ${res.updated} keyword${res.updated === 1 ? "" : "s"}${res.noData ? ` (${res.noData} with no data)` : ""}.`)}`);
  }
  const msg =
    res.reason === "no_provider"
      ? "No search-data provider is connected. Add a DataForSEO or Keywords Everywhere key under Settings → Keys."
      : res.reason === "nothing_to_fetch"
        ? "No active keywords to look up."
        : `Volume refresh failed: ${res.error ?? "unknown error"}`;
  redirect(`/blog/keywords?err=${encodeURIComponent(msg)}`);
}

export async function addKeywordAction(formData: FormData) {
  const phrase = String(formData.get("phrase") ?? "").trim().toLowerCase();
  if (!phrase) return;
  const tier = Math.min(4, Math.max(1, parseInt(String(formData.get("tier") ?? "3"), 10) || 3));
  const { workspace } = await requireRole("EDITOR");
  await db.keyword.upsert({
    where: { workspaceId_phrase: { workspaceId: workspace.id, phrase } },
    update: { tier },
    create: { workspaceId: workspace.id, phrase, tier, cluster: String(formData.get("cluster") ?? "").trim() || null },
  });
  await syncNewPhrases(workspace.id, [phrase]);
  revalidatePath("/blog/keywords");
}

export async function updateKeywordAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const kw = await db.keyword.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!kw) return;
  const tier = parseInt(String(formData.get("tier") ?? ""), 10);
  const intent = String(formData.get("intent") ?? "").trim();
  await db.keyword.update({
    where: { id },
    data: {
      tier: Number.isFinite(tier) && tier >= 1 && tier <= 4 ? tier : kw.tier,
      intent: ["informational", "commercial", "transactional", "navigational"].includes(intent) ? intent : kw.intent,
      cluster: String(formData.get("cluster") ?? "").trim() || null,
      status: String(formData.get("status")) === "paused" ? "paused" : "active",
    },
  });
  revalidatePath("/blog/keywords");
}

export async function deleteKeywordAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.keyword.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/blog/keywords");
}

/** AI keyword discovery grounded in the org profile; dedupes against existing. */
export async function discoverKeywordsAction() {
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const [org, existing] = await Promise.all([
    db.orgProfile.findUnique({ where: { workspaceId: workspace.id } }),
    db.keyword.findMany({ where: { workspaceId: workspace.id }, select: { phrase: true }, take: 100 }),
  ]);

  const system =
    "You are an SEO strategist. Respond ONLY with a JSON array: " +
    '[{"phrase": string, "tier": 1|2|3|4, "intent": "informational"|"commercial"|"transactional"|"navigational", "cluster": string}]. ' +
    "Tier 1 = head terms, 4 = specific long-tail. Cluster = short topical group name. " +
    "No search-volume numbers — you do not have that data (a search-data provider fills them in afterwards). Lowercase phrases.";
  const prompt = [
    org?.description
      ? `Organization: ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Audience: ${org.audience}.` : ""}`
      : "No org profile set — propose broadly useful business keywords and note grounding is missing.",
    existing.length ? `Do not repeat: ${existing.map((k) => k.phrase).join(", ")}` : null,
    "Propose 12 keywords across tiers 1-4 in 2-4 clusters.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    // ⚠ 8000, not 1500 — the documented reasoning-model trap (CLAUDE.md). Both
    // real tenants sit on a gemini `-pro` model, which spends its budget
    // thinking before it emits: at 1500 this returned EMPTY, the JSON match
    // failed, and the action silently created nothing. The audit trail agrees —
    // `keywords.ai_discovery` has never been written in any workspace.
    maxTokens: 8000,
    timeoutMs: 120_000,
    workspaceId: workspace.id,
  });
  // ⚠ Mock keywords are fluent garbage a person would then build a strategy on.
  // Same rule as ideation and SEO: refuse, say so, store nothing.
  if (res.provider === "mock") {
    await writeAudit({
      workspaceId: workspace.id,
      action: "keywords.discovery_failed",
      entityType: "keyword",
      meta: { provider: "mock", reason: "provider unavailable — refused to store mock keywords" },
    });
    redirect(`/blog/keywords?err=${encodeURIComponent("No working AI key for this workspace, so nothing was generated — add one under Settings → Keys.")}`);
  }
  let rows: Array<{ phrase?: string; tier?: number; intent?: string; cluster?: string }> = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    rows = m ? JSON.parse(m[0]) : [];
  } catch {
    rows = [];
  }
  let created = 0;
  const written: string[] = [];
  for (const r of rows.slice(0, 12)) {
    // stripListMarker: the model writes JSON but still leaves "- " inside the
    // value — the same artefact that put a dash in a published title (A3).
    const phrase = typeof r.phrase === "string" ? stripListMarker(r.phrase).toLowerCase().slice(0, 120).trim() : "";
    if (!phrase) continue;
    written.push(phrase);
    await db.keyword.upsert({
      where: { workspaceId_phrase: { workspaceId: workspace.id, phrase } },
      update: {},
      create: {
        workspaceId: workspace.id,
        phrase,
        tier: typeof r.tier === "number" && r.tier >= 1 && r.tier <= 4 ? r.tier : 3,
        intent: ["informational", "commercial", "transactional", "navigational"].includes(r.intent ?? "") ? r.intent : null,
        cluster: typeof r.cluster === "string" ? r.cluster.trim().slice(0, 80) || null : null,
      },
    });
    created++;
  }
  await writeAudit({
    workspaceId: workspace.id,
    action: "keywords.ai_discovery",
    entityType: "keyword",
    meta: { created },
  });
  // The model proposes phrases; only the provider may attach numbers to them.
  await syncNewPhrases(workspace.id, written);
  revalidatePath("/blog/keywords");
}

/**
 * LLM intent + cluster classification for keywords that lack them.
 *
 * ⚠ Keywords only arrive pre-classified when AI discovery wrote them. Anything
 * added by hand, by the assistant's `add_keyword`, or in bulk lands with no
 * intent and no cluster — which is how CommunityForce ended up with 42 rows
 * reading as ten columns of dashes (audit A4). This is the one button that
 * fixes that, so it also fills the cluster now, not just the intent.
 */
export async function classifyIntentsAction() {
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const missing = await db.keyword.findMany({
    where: { workspaceId: workspace.id, OR: [{ intent: null }, { cluster: null }] },
    take: 40,
  });
  if (!missing.length) return;
  const remaining = await db.keyword.count({
    where: { workspaceId: workspace.id, OR: [{ intent: null }, { cluster: null }] },
  });
  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system:
      "You are an SEO strategist. For every phrase given, return its search intent and a short topical cluster name. " +
      'Respond ONLY with a JSON object mapping each phrase to {"intent": "informational"|"commercial"|"transactional"|"navigational", "cluster": string}. ' +
      "Cluster names must be reused across related phrases — aim for 3-6 clusters in total, not one per phrase.",
    messages: [{ role: "user", content: missing.map((k) => k.phrase).join("\n") }],
    // ⚠ 4000, not 800 — same reasoning-model cushion as discovery above. At 800
    // a `-pro` model returns empty, the JSON match fails and the button appears
    // to do nothing at all, which is exactly what the owner saw.
    maxTokens: 4000,
    timeoutMs: 120_000,
    workspaceId: workspace.id,
  });
  if (res.provider === "mock") {
    redirect(`/blog/keywords?err=${encodeURIComponent("No working AI key for this workspace, so nothing was classified — add one under Settings → Keys.")}`);
  }
  let map: Record<string, { intent?: string; cluster?: string }> = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    map = m ? JSON.parse(m[0]) : {};
  } catch {
    map = {};
  }
  const INTENTS = ["informational", "commercial", "transactional", "navigational"];
  let classified = 0;
  for (const k of missing) {
    const hit = map[k.phrase];
    if (!hit || typeof hit !== "object") continue;
    const intent = typeof hit.intent === "string" && INTENTS.includes(hit.intent) ? hit.intent : null;
    const cluster = typeof hit.cluster === "string" ? stripListMarker(hit.cluster).slice(0, 80) || null : null;
    if (!intent && !cluster) continue;
    await db.keyword.update({
      where: { id: k.id },
      // Never overwrite something already set by hand.
      data: { ...(intent && !k.intent ? { intent } : {}), ...(cluster && !k.cluster ? { cluster } : {}) },
    });
    classified++;
  }
  await writeAudit({
    workspaceId: workspace.id,
    action: "keywords.classified",
    entityType: "keyword",
    meta: { classified, offered: missing.length },
  });
  revalidatePath("/blog/keywords");
  const left = remaining - classified;
  redirect(
    `/blog/keywords?ok=${encodeURIComponent(
      classified === 0
        ? "The model returned nothing usable — try again, or set the intent by hand."
        : `Classified ${classified} keyword${classified === 1 ? "" : "s"}.${left > 0 ? ` ${left} still to go — press again.` : ""}`,
    )}`,
  );
}

/** Spin a blog idea directly from a keyword. */
export async function ideaFromKeywordAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const kw = await db.keyword.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!kw) return;
  await db.blogIdea.create({
    data: {
      workspaceId: workspace.id,
      title: `Article targeting "${kw.phrase}"`,
      keyword: kw.phrase,
      angle: kw.cluster ? `Part of the "${kw.cluster}" cluster${kw.intent ? `; ${kw.intent} intent` : ""}.` : null,
      source: "manual",
    },
  });
  revalidatePath("/blog");
  revalidatePath("/blog/keywords");
}
