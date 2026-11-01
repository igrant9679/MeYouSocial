import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * Unfinished channels and who may start one (E-SET-09).
 *
 * The wizard creates the channel on step 1, so a wizard left half-way leaves
 * an "Untitled channel" in the switcher. A channel is a DRAFT until step 4
 * saves its differentiation — that step starts the voice, audience and ideas
 * jobs, so a draft holds nothing but its niche and, perhaps, competitors.
 */

/** "admins" restricts starting (and continuing) a channel to admins; empty = editors and admins, as before. */
export const CHANNEL_CREATORS_SETTING = "channels:creators";

export async function mayCreateChannels(workspaceId: string, role: Role): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role !== "EDITOR") return false;
  return (await getSetting(CHANNEL_CREATORS_SETTING, workspaceId).catch(() => "")) !== "admins";
}

/** Drafts untouched this long can be cleared in one go by an admin. */
export const STALE_DRAFT_DAYS = 7;

/** Where the wizard picks up: the first step that hasn't been done. */
export function resumeHref(c: { id: string; name: string; linkedYoutubeId: string | null; competitors: number }): string {
  const path = c.linkedYoutubeId ? "youtube" : "custom";
  if (c.name === "Untitled channel" && !c.linkedYoutubeId) return `/onboarding/channel/${c.id}?step=2`;
  if (c.competitors === 0) return `/onboarding/channel/${c.id}?step=3&path=${path}`;
  return `/onboarding/channel/${c.id}?step=4&path=${path}`;
}

/** Every draft in the workspace, oldest first, with whether anything beyond the wizard's own fields hangs off it. */
export async function draftChannels(workspaceId: string) {
  const rows = await db.channel.findMany({
    where: { workspaceId, differentiation: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, createdAt: true, updatedAt: true, linkedYoutubeId: true,
      _count: { select: { competitors: true, ideas: true, scripts: true, contentProjects: true, research: true, submissions: true, templates: true, voiceProfiles: true } },
    },
  });
  const staleBefore = Date.now() - STALE_DRAFT_DAYS * 86_400_000;
  return rows.map((r) => {
    const { competitors, ...rest } = r._count;
    const empty = Object.values(rest).every((n) => n === 0);
    return {
      id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt,
      // Content made outside the wizard — a draft with any is not "empty" and only an admin deletes it, the usual way.
      empty,
      /** Empty and untouched for STALE_DRAFT_DAYS — what an admin's "Clear" removes. */
      stale: empty && r.updatedAt.getTime() < staleBefore,
      resume: resumeHref({ id: r.id, name: r.name, linkedYoutubeId: r.linkedYoutubeId, competitors }),
    };
  });
}
