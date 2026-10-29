import { getSetting } from "@/lib/settings";

/**
 * Incident mode (E-SEC-06) — the platform operator's response to a leak.
 *
 * Two platform Settings, both 30s-cached reads like every setting:
 *   · `security:incident` — what was declared, when and by whom; while it is set,
 *     every workspace's admins see a banner. Cleared when the operator ends it.
 *   · `security:sessions_valid_after` — the moment "sign everyone out" ran. The
 *     jwt callback in auth.ts refuses any session signed in before it, so a stolen
 *     cookie stops working within the cache window. It stays set after the incident
 *     ends: sessions made since are newer and unaffected.
 */
export const INCIDENT_SETTING = "security:incident";
export const SESSIONS_AFTER_SETTING = "security:sessions_valid_after";

/** The steps the operator can take; each is recorded on the incident. */
export const INCIDENT_STEPS = ["sessions", "invitations", "tokens", "oauth"] as const;
export type IncidentStep = (typeof INCIDENT_STEPS)[number];

export type Incident = { since: string; note: string; by: string; steps: IncidentStep[] };

export async function currentIncident(): Promise<Incident | null> {
  try {
    const raw = await getSetting(INCIDENT_SETTING);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Incident>;
    return v.since ? { since: v.since, note: v.note ?? "", by: v.by ?? "", steps: (v.steps ?? []).filter((s): s is IncidentStep => (INCIDENT_STEPS as readonly string[]).includes(s)) } : null;
  } catch {
    return null;
  }
}

/** Sessions signed in before this moment (ms) are refused; 0 = none are. */
export async function sessionsValidAfter(): Promise<number> {
  const raw = await getSetting(SESSIONS_AFTER_SETTING);
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(at) ? at : 0;
}

/** Stored OAuth connections that "force reconnects" clears — per workspace, never Drive storage. */
export const RECONNECT_KEYS = ["youtube_oauth:refresh_token", "ganalytics_oauth:refresh_token"] as const;
