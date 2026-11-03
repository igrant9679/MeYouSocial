import { getCurrentUser } from "@/lib/acl";
import { getPostingTimeZone } from "@/lib/social/slots";

/**
 * The zone a person READS times in (E-SHL-09): their own when they chose one
 * under Settings → Profile, else the workspace's posting zone.
 *
 * ⚠ Display only. Anything a time is typed into or scheduled by — posting
 * slots, publish dates, the calendar, the composer, Measure's ranges — stays in
 * the posting zone, so "Tuesday 09:00" means the same moment to everyone on the
 * team. Use this where a page only shows when something happened: notifications,
 * comments, the audit log, the assistant's history, the job queue.
 */
export async function displayTimeZone(workspaceId: string): Promise<string> {
  const user = await getCurrentUser();
  if (user?.timeZone && isTimeZone(user.timeZone)) return user.timeZone;
  return getPostingTimeZone(workspaceId).catch(() => "UTC");
}

/** A zone this runtime knows (Intl refuses anything else). */
export function isTimeZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: z });
    return z.length > 0 && z.length < 64;
  } catch {
    return false;
  }
}

/** Every IANA zone the runtime lists, for the picker. */
export function timeZoneChoices(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/London", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Tokyo"];
  }
}
