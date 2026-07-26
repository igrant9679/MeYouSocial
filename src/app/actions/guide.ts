"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Elsie's on/off state and progress.
 *
 * Cookies, matching how theme and content size are already stored — this is a
 * per-person UI preference, not workspace data, and it must survive being read
 * in the layout on every render without a query.
 *
 * Two cookies rather than one JSON blob so a malformed value can only break the
 * half it belongs to: an unreadable progress list still leaves the toggle
 * working.
 */

const ON_COOKIE = "meyousocial_elsie";
const DONE_COOKIE = "meyousocial_elsie_done";
/**
 * Session-scoped "not now".
 *
 * Without this, closing Elsie only hid her until the next render: any
 * navigation or server action re-evaluated the remaining steps and popped her
 * straight back open at the next one. Reported from the field as "she keeps
 * popping up when I'm in the middle of using the tool" — correctly, because
 * dismissing has to mean something.
 *
 * No maxAge on purpose: it dies with the browser session, so she can greet
 * someone again tomorrow without ever nagging them today.
 */
const SNOOZE_COOKIE = "meyousocial_elsie_snooze";
const YEAR = 60 * 60 * 24 * 365;

export type GuideState = { enabled: boolean; done: string[]; snoozed: boolean };

function opts() {
  // Client-readable: the tour reads its own state without a round trip.
  return { httpOnly: false, sameSite: "lax" as const, path: "/", maxAge: YEAR };
}

export async function getGuideState(): Promise<GuideState> {
  const jar = await cookies();
  // ABSENT means new — Elsie is on by default, which is the whole point of a
  // guide for new users. Only an explicit "off" turns her off.
  const enabled = jar.get(ON_COOKIE)?.value !== "off";
  const raw = jar.get(DONE_COOKIE)?.value ?? "";
  const done = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    // Bound it: a corrupted cookie must not grow without limit.
    .slice(0, 60);
  return { enabled, done, snoozed: jar.get(SNOOZE_COOKIE)?.value === "1" };
}

/** "Not now" — stop auto-opening for the rest of this browser session. */
export async function snoozeGuideAction() {
  const jar = await cookies();
  jar.set(SNOOZE_COOKIE, "1", { httpOnly: false, sameSite: "lax", path: "/" });
}

export async function setGuideEnabledAction(formData: FormData) {
  const on = String(formData.get("on") ?? "") === "1";
  const jar = await cookies();
  jar.set(ON_COOKIE, on ? "on" : "off", opts());
  // Turning her back on means "show me again", so past progress AND any
  // session snooze are cleared — otherwise the button would appear to do
  // nothing for someone who had finished or dismissed the tour.
  if (on) {
    jar.set(DONE_COOKIE, "", { ...opts(), maxAge: 0 });
    jar.set(SNOOZE_COOKIE, "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  }
  revalidatePath("/", "layout");
}

/** Record completed steps. Called as the tour advances and when it's closed. */
export async function markGuideStepsDoneAction(ids: string[]) {
  const jar = await cookies();
  const existing = (jar.get(DONE_COOKIE)?.value ?? "").split(",").filter(Boolean);
  const merged = [...new Set([...existing, ...ids.filter(Boolean)])].slice(0, 60);
  jar.set(DONE_COOKIE, merged.join(","), opts());
}
