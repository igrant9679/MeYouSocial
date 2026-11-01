import { db } from "@/lib/db";

/**
 * The public topic form's channel (E-SET-08), by its custom slug or its id —
 * slug first. A channel in a deleted workspace has no form (security part 8).
 */
export async function channelForSubmit(slugOrId: string) {
  const select = { id: true, workspaceId: true, name: true, accentColor: true, nicheDescription: true, submissionsOpen: true, submitSlug: true } as const;
  const key = slugOrId.slice(0, 64);
  return (await db.channel.findFirst({ where: { submitSlug: key.toLowerCase(), workspace: { deletedAt: null } }, select }))
    ?? (await db.channel.findFirst({ where: { id: key, workspace: { deletedAt: null } }, select }));
}

/**
 * Why a slug can't be used, or null. Lowercase letters, digits and dashes,
 * 3–40 long; never shaped like a record id, or it could shadow another
 * channel's /submit/<id> address.
 */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(slug)) return "Use 3–40 lowercase letters, digits and dashes (not starting or ending with a dash).";
  if (/^c[a-z0-9]{20,}$/.test(slug)) return "That looks like a record id — pick a name.";
  return null;
}

/** The form's public path: the slug when it has one. */
export const submitPath = (c: { id: string; submitSlug: string | null }) => `/submit/${c.submitSlug ?? c.id}`;
