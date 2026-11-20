import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/acl";

/**
 * A record that isn't in the active workspace but is in another one this person
 * is an active member of (2026-11-19, the owner's 404 on an LSI draft; first the
 * article page, then every record page).
 *
 * Every record page looks its id up in the ACTIVE workspace only, so a link
 * carried across a switch — a tab reloaded after switching in another tab (the
 * WorkspaceGuard's "Reload"), an email, a notification, a copied address — used to
 * land on a bare "not found". A record page's not-found branch now calls
 * `elsewhereOr404(<its own path>)`: if the record is in another of this person's
 * workspaces they go to `/elsewhere`, which names the workspace and offers to
 * switch; anything else is the same 404 as before.
 *
 * Only the person's own ACTIVE memberships are searched: a workspace they aren't
 * in, a revoked membership or a deleted workspace stays "not found", so nothing
 * about another tenant is revealed. A record only its owner may open (an Elsie
 * conversation) is looked for with that owner's id, as its page does.
 *
 * The path is the whole interface: `ROUTES` says which record routes there are,
 * and a path that matches none is refused — so `/elsewhere?to=` and the switch
 * action can only ever send someone to one of these record pages.
 */

const ID = "([a-z0-9]{16,40})";
const re = (s: string) => new RegExp(`^${s}$`);

type Found = { workspaceId: string; title: string | null } | null;
type Route = {
  /** What the notice calls it: "This <noun> is in another workspace". */
  noun: string;
  /** Where "Stay in …" goes: the list this kind of record lives in. */
  home: string;
  /** The record's pages; group 1 is its id. */
  path: RegExp;
  find: (id: string, workspaceIds: string[], userId: string) => Promise<Found>;
};

const inWs = (ws: string[]) => ({ in: ws });
const snippet = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 60);

export const ROUTES: Route[] = [
  {
    noun: "article", home: "/blog", path: re(`/blog/${ID}(?:/(?:versions|update|retire))?`),
    find: (id, ws) => db.blogPost.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
  {
    noun: "expert", home: "/blog/experts", path: re(`/blog/experts/${ID}`),
    find: async (id, ws) => {
      const r = await db.smeProfile.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, name: true } });
      return r && { workspaceId: r.workspaceId, title: r.name };
    },
  },
  {
    noun: "social post", home: "/distribute", path: re(`/social/${ID}(?:/edit)?`),
    find: async (id, ws) => {
      const r = await db.socialPost.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, text: true } });
      return r && { workspaceId: r.workspaceId, title: snippet(r.text) };
    },
  },
  {
    noun: "campaign", home: "/distribute", path: re(`/social/campaigns/${ID}`),
    find: async (id, ws) => {
      const r = await db.campaign.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, name: true } });
      return r && { workspaceId: r.workspaceId, title: r.name };
    },
  },
  {
    noun: "caption set", home: "/social/captions", path: re(`/social/captions/${ID}`),
    find: (id, ws) => db.captionBatch.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
  {
    noun: "idea", home: "/ideas", path: re(`/ideas/article/${ID}`),
    find: (id, ws) => db.blogIdea.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
  {
    noun: "idea", home: "/ideas", path: re(`/ideas/social/${ID}`),
    find: async (id, ws) => {
      const r = await db.socialIdea.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, hook: true } });
      return r && { workspaceId: r.workspaceId, title: snippet(r.hook) };
    },
  },
  {
    noun: "Topic", home: "/ideas/topics", path: re(`/ideas/topics/${ID}`),
    find: async (id, ws) => {
      const r = await db.topic.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, name: true } });
      return r && { workspaceId: r.workspaceId, title: r.name };
    },
  },
  {
    noun: "script", home: "/scripts", path: re(`/scripts/${ID}(?:/(?:builder|publish|versions))?`),
    find: async (id, ws) => {
      const r = await db.script.findFirst({ where: { id, channel: { workspaceId: inWs(ws) } }, select: { title: true, channel: { select: { workspaceId: true } } } });
      return r && { workspaceId: r.channel.workspaceId, title: r.title };
    },
  },
  {
    noun: "project", home: "/production", path: re(`/production/projects/${ID}`),
    find: async (id, ws) => {
      const r = await db.contentProject.findFirst({ where: { id, channel: { workspaceId: inWs(ws) } }, select: { title: true, channel: { select: { workspaceId: true } } } });
      return r && { workspaceId: r.channel.workspaceId, title: r.title };
    },
  },
  {
    noun: "document", home: "/production/wiki", path: re(`/production/wiki/${ID}`),
    find: (id, ws) => db.wikiDoc.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
  {
    noun: "render", home: "/videos", path: re(`/videos/${ID}`),
    find: (id, ws) => db.videoRender.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
  {
    noun: "thumbnail", home: "/thumbnails", path: re(`/thumbnails/${ID}`),
    find: async (id, ws) => {
      const r = await db.thumbnail.findFirst({ where: { id, channel: { workspaceId: inWs(ws) } }, select: { title: true, channel: { select: { workspaceId: true } } } });
      return r && { workspaceId: r.channel.workspaceId, title: r.title };
    },
  },
  {
    noun: "competitor channel", home: "/intel", path: re(`/intel/channels/${ID}`),
    find: (id, ws) => db.intelChannel.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, name: true } })
      .then((r) => r && { workspaceId: r.workspaceId, title: r.name }),
  },
  {
    noun: "competitor video", home: "/intel", path: re(`/intel/videos/${ID}`),
    find: async (id, ws) => {
      const r = await db.intelVideo.findFirst({ where: { id, intelChannel: { workspaceId: inWs(ws) } }, select: { title: true, intelChannel: { select: { workspaceId: true } } } });
      return r && { workspaceId: r.intelChannel.workspaceId, title: r.title };
    },
  },
  {
    // Every channel page goes through requireChannel(), which sends the channel's
    // home path — its layout and its page both check, so they must agree.
    noun: "channel", home: "/admin/channels", path: re(`/channels/${ID}`),
    find: async (id, ws) => {
      const r = await db.channel.findFirst({ where: { id, workspaceId: inWs(ws) }, select: { workspaceId: true, name: true } });
      return r && { workspaceId: r.workspaceId, title: r.name };
    },
  },
  {
    // Only its owner may open a conversation, in any workspace.
    noun: "conversation with Elsie", home: "/assistant", path: re(`/assistant/${ID}`),
    find: (id, ws, userId) => db.assistantThread.findFirst({ where: { id, userId, workspaceId: inWs(ws) }, select: { workspaceId: true, title: true } }),
  },
];

/** A record page's path, matched to its route; a `?tab=` is kept, any other query dropped. */
export function parseRecordPath(to: string): { route: Route; id: string; to: string } | null {
  if (typeof to !== "string" || to.length > 200) return null;
  const [pathname, query = ""] = to.split("?", 2);
  for (const route of ROUTES) {
    const m = pathname.match(route.path);
    if (!m) continue;
    const tab = new URLSearchParams(query).get("tab");
    return { route, id: m[1], to: `${pathname}${tab && /^[a-z]{2,20}$/.test(tab) ? `?tab=${tab}` : ""}` };
  }
  return null;
}

type MemberLike = { workspaceId: string; status: string; workspace: { name: string } };
export type RecordWhere = { to: string; noun: string; home: string; title: string; workspaceId: string; workspaceName: string };

/** Which of these memberships' workspaces holds the record at `to` — active memberships only. */
export async function locateRecord(memberships: MemberLike[], userId: string, to: string): Promise<RecordWhere | null> {
  const target = parseRecordPath(to);
  if (!target) return null;
  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) return null;
  const found = await target.route.find(target.id, active.map((m) => m.workspaceId), userId);
  if (!found) return null;
  const ws = active.find((m) => m.workspaceId === found.workspaceId);
  if (!ws) return null;
  const noun = target.route.noun;
  return { to: target.to, noun, home: target.route.home, title: found.title?.trim() || `Untitled ${noun}`, workspaceId: ws.workspaceId, workspaceName: ws.workspace.name };
}

/**
 * A record page's not-found branch: `if (!post) return elsewhereOr404(`/social/${id}`)`.
 * If the record is in another of this person's workspaces, go to the notice that
 * offers the switch; otherwise the same 404 as before. Never returns.
 */
export async function elsewhereOr404(to: string): Promise<never> {
  const { user, workspace } = await requireMembership();
  const hit = await locateRecord(user.memberships, user.id, to);
  if (hit && hit.workspaceId !== workspace.id) redirect(`/elsewhere?to=${encodeURIComponent(hit.to)}`);
  notFound();
}
