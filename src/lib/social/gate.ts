import { getSetting } from "@/lib/settings";

/**
 * The per-format idea gate for social ("Topics as the spine", phase 4).
 *
 *   auto  — a social idea the ENGINE discovers is approved in the same sweep
 *           it is born, so the engine's social output keeps today's volume
 *           and cadence and gains a Topic and a source. This is the default
 *           because both tenants were posting social unattended when the
 *           idea stage arrived (LSI had 11 posts scheduled ahead); a human
 *           gate would have silently stopped that feed the day it shipped.
 *   human — engine-discovered social ideas wait on the board like article
 *           ideas do, and the Inbox counts them to triage.
 *
 * Article ideas are always a person's decision (standing rule — not a dial);
 * video ideas likewise (a script is expensive). Ideas a PERSON adds — manual
 * or from Research — are never auto-approved under either setting: whoever
 * made them approves them.
 *
 * Full autonomy sets this to `auto` and snapshots it like the other dials.
 */
export const SOCIAL_GATE_KEY = "ideas:social_gate";
export type SocialGate = "auto" | "human";

export async function socialGate(workspaceId: string): Promise<SocialGate> {
  const raw = (await getSetting(SOCIAL_GATE_KEY, workspaceId).catch(() => "")).trim();
  return raw === "human" ? "human" : "auto";
}

/** Which way the engine writes social posts. `rotation` is the rollback to the pre-spine generator. */
export const SOCIAL_SOURCE_KEY = "social:source";
export type SocialSource = "ideas" | "rotation";

export async function socialSource(workspaceId: string): Promise<SocialSource> {
  const raw = (await getSetting(SOCIAL_SOURCE_KEY, workspaceId).catch(() => "")).trim();
  return raw === "rotation" ? "rotation" : "ideas";
}
