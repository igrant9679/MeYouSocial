import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

/**
 * The registry of things a user is allowed to delete, and the ONLY place that
 * decides it.
 *
 * Why a registry instead of a delete action per surface: the app had focused
 * delete actions for ~20 leaf records (blog posts, keywords, slots…) and none
 * at all for the structural ones — channels, scripts, ideas, chats, projects,
 * tasks, assets, workspaces. Adding twenty more bespoke actions would have
 * meant twenty more places to get the tenant check wrong. Here every kind
 * declares its own scoping query, one action enforces it, and one button
 * renders it.
 *
 * ⚠ THE TENANT BOUNDARY LIVES IN `find` AND `remove`, AND BOTH TAKE THE
 * CALLER'S workspaceId. Never add a kind whose queries ignore it — that is the
 * whole multi-tenant guarantee, and a `deleteMany({ where: { id } })` without
 * it would let any admin delete another company's row by guessing an id.
 * `remove` re-filters rather than trusting that `find` already ran.
 */

export type DeletableKind =
  | "channel" | "idea" | "script" | "chat" | "thumbnail" | "contentProject"
  | "task" | "asset" | "wikiDoc" | "audienceSubmission" | "audienceAvatar"
  | "invitation" | "membership" | "zernioAccount" | "workspace" | "campaign";

export type DeletableTarget = { id: string; name: string };

export type Deletable = {
  /** Human noun, lowercase — used in confirmations: "Delete this channel?" */
  label: string;
  /** Minimum role. Anything that destroys other people's work is ADMIN. */
  role: Role;
  /**
   * Require the user to type the record's name before the delete is accepted.
   * Reserved for kinds that take a large amount of other data with them — a
   * misclick on a channel loses every script, idea and project under it.
   */
  typeToConfirm?: boolean;
  find(id: string, workspaceId: string): Promise<DeletableTarget | null>;
  /** What else disappears, for the confirmation copy. Cascades, mostly. */
  impact?(id: string, workspaceId: string): Promise<Array<[string, number]>>;
  remove(id: string, workspaceId: string): Promise<void>;
  /** Where to send the user afterwards. Falls back to the referring page. */
  redirectTo?: (target: DeletableTarget) => string;
  revalidate: string[];
};

/** Drops zero counts so the confirmation lists only what actually exists. */
function nonZero(pairs: Array<[string, number]>): Array<[string, number]> {
  return pairs.filter(([, n]) => n > 0);
}

export const DELETABLE: Record<DeletableKind, Deletable> = {
  channel: {
    label: "channel",
    role: "ADMIN",
    typeToConfirm: true,
    async find(id, workspaceId) {
      const c = await db.channel.findFirst({ where: { id, workspaceId }, select: { id: true, name: true } });
      return c;
    },
    async impact(id, workspaceId) {
      const scope = { channel: { id, workspaceId } };
      const [ideas, scripts, chats, thumbnails, projects, voices, assets, docs, research, competitors, submissions, memory, templates] = await Promise.all([
        db.idea.count({ where: scope }), db.script.count({ where: scope }), db.chat.count({ where: scope }),
        db.thumbnail.count({ where: scope }), db.contentProject.count({ where: scope }), db.voiceProfile.count({ where: scope }),
        db.asset.count({ where: scope }), db.wikiDoc.count({ where: scope }), db.researchSource.count({ where: scope }),
        db.competitor.count({ where: scope }), db.audienceSubmission.count({ where: scope }),
        db.channelMemoryEntry.count({ where: scope }), db.template.count({ where: { channelId: id } }),
      ]);
      return nonZero([
        ["ideas", ideas], ["scripts", scripts], ["chats", chats], ["thumbnails", thumbnails],
        ["production projects", projects], ["voice profiles", voices], ["assets", assets],
        ["wiki docs", docs], ["research sources", research], ["competitors", competitors],
        ["audience submissions", submissions], ["memory entries", memory], ["channel templates", templates],
      ]);
    },
    async remove(id, workspaceId) {
      const channel = await db.channel.findFirst({ where: { id, workspaceId }, select: { id: true } });
      if (!channel) return;
      // `Workspace.defaultChannelId` is a UNIQUE column with no cascade — leave
      // it pointing at a deleted row and the workspace is wedged. Clear first.
      await db.workspace.updateMany({ where: { id: workspaceId, defaultChannelId: id }, data: { defaultChannelId: null } });
      await db.channel.delete({ where: { id } });
    },
    redirectTo: () => "/admin/channels",
    revalidate: ["/admin/channels", "/channels", "/"],
  },

  campaign: {
    label: "campaign",
    role: "ADMIN",
    find: (id, workspaceId) => db.campaign.findFirst({ where: { id, workspaceId }, select: { id: true, name: true } }),
    async impact(id, workspaceId) {
      // SocialPost.campaignId is SetNull — the posts survive, they just unlink.
      const posts = await db.socialPost.count({ where: { campaignId: id, workspaceId } });
      return nonZero([["posts (kept, unlinked)", posts]]);
    },
    async remove(id, workspaceId) { await db.campaign.deleteMany({ where: { id, workspaceId } }); },
    revalidate: ["/social"],
  },

  idea: {
    label: "idea",
    role: "EDITOR",
    find: (id, workspaceId) => db.idea.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title } : null)),
    async remove(id, workspaceId) { await db.idea.deleteMany({ where: { id, channel: { workspaceId } } }); },
    revalidate: ["/ideas"],
  },

  script: {
    label: "script",
    role: "EDITOR",
    typeToConfirm: true,
    find: (id, workspaceId) => db.script.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title } : null)),
    async impact(id) {
      const [versions, projects] = await Promise.all([
        db.scriptVersion.count({ where: { scriptId: id } }),
        db.contentProject.count({ where: { scriptId: id } }),
      ]);
      // ContentProject.scriptId is nullable — projects survive, they just lose
      // the link. Say so rather than implying they get deleted.
      return nonZero([["saved versions", versions], ["linked projects (kept, unlinked)", projects]]);
    },
    async remove(id, workspaceId) { await db.script.deleteMany({ where: { id, channel: { workspaceId } } }); },
    redirectTo: () => "/scripts",
    revalidate: ["/scripts"],
  },

  chat: {
    label: "chat",
    role: "EDITOR",
    find: (id, workspaceId) => db.chat.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title ?? "chat" } : null)),
    async remove(id, workspaceId) { await db.chat.deleteMany({ where: { id, channel: { workspaceId } } }); },
    redirectTo: () => "/chat",
    revalidate: ["/chat"],
  },

  thumbnail: {
    label: "thumbnail",
    role: "EDITOR",
    find: (id, workspaceId) => db.thumbnail.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title ?? "thumbnail" } : null)),
    async remove(id, workspaceId) { await db.thumbnail.deleteMany({ where: { id, channel: { workspaceId } } }); },
    revalidate: ["/thumbnails"],
  },

  contentProject: {
    label: "project",
    role: "EDITOR",
    typeToConfirm: true,
    find: (id, workspaceId) => db.contentProject.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title } : null)),
    async impact(id) {
      const [tasks, derivatives, links] = await Promise.all([
        db.task.count({ where: { contentProjectId: id } }),
        db.contentProject.count({ where: { parentId: id } }),
        db.assetLink.count({ where: { contentProjectId: id } }),
      ]);
      // Task.contentProject is an OPTIONAL relation with no cascade, so Prisma
      // nulls the link rather than deleting the task. Say "kept" — claiming
      // tasks are destroyed when they survive is the kind of wrong that makes
      // people distrust every other line in this list.
      return nonZero([["tasks (kept, unlinked)", tasks], ["derivative projects", derivatives], ["asset links", links]]);
    },
    async remove(id, workspaceId) { await db.contentProject.deleteMany({ where: { id, channel: { workspaceId } } }); },
    redirectTo: () => "/production",
    revalidate: ["/production"],
  },

  task: {
    label: "task",
    role: "EDITOR",
    find: (id, workspaceId) => db.task.findFirst({ where: { id, workspaceId }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title } : null)),
    async remove(id, workspaceId) { await db.task.deleteMany({ where: { id, workspaceId } }); },
    revalidate: ["/production"],
  },

  asset: {
    label: "asset",
    role: "EDITOR",
    find: (id, workspaceId) => db.asset.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, name: true } }),
    async impact(id) {
      const links = await db.assetLink.count({ where: { assetId: id } });
      return nonZero([["links from projects", links]]);
    },
    async remove(id, workspaceId) { await db.asset.deleteMany({ where: { id, channel: { workspaceId } } }); },
    revalidate: ["/production"],
  },

  wikiDoc: {
    label: "wiki doc",
    role: "EDITOR",
    find: (id, workspaceId) => db.wikiDoc.findFirst({ where: { id, workspaceId }, select: { id: true, title: true } })
      .then((r) => (r ? { id: r.id, name: r.title } : null)),
    async remove(id, workspaceId) { await db.wikiDoc.deleteMany({ where: { id, workspaceId } }); },
    revalidate: ["/production"],
  },

  audienceSubmission: {
    label: "submission",
    role: "EDITOR",
    find: (id, workspaceId) => db.audienceSubmission.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, topic: true } })
      .then((r) => (r ? { id: r.id, name: r.topic.slice(0, 60) } : null)),
    async remove(id, workspaceId) { await db.audienceSubmission.deleteMany({ where: { id, channel: { workspaceId } } }); },
    revalidate: ["/submissions"],
  },

  audienceAvatar: {
    label: "audience profile",
    role: "EDITOR",
    find: (id, workspaceId) => db.audienceAvatar.findFirst({ where: { id, channel: { workspaceId } }, select: { id: true, channelId: true } })
      .then((r) => (r ? { id: r.id, name: "audience profile" } : null)),
    async remove(id, workspaceId) { await db.audienceAvatar.deleteMany({ where: { id, channel: { workspaceId } } }); },
    revalidate: [],
  },

  invitation: {
    label: "invitation",
    role: "ADMIN",
    find: (id, workspaceId) => db.invitation.findFirst({ where: { id, workspaceId }, select: { id: true, email: true } })
      .then((r) => (r ? { id: r.id, name: r.email } : null)),
    async remove(id, workspaceId) { await db.invitation.deleteMany({ where: { id, workspaceId } }); },
    revalidate: ["/admin"],
  },

  membership: {
    label: "member",
    role: "ADMIN",
    find: (id, workspaceId) => db.membership.findFirst({ where: { id, workspaceId }, select: { id: true, user: { select: { email: true } } } })
      .then((r) => (r ? { id: r.id, name: r.user.email } : null)),
    async remove(id, workspaceId) {
      // ⚠ Never let a workspace end up with no admin — that locks everyone out
      // of its settings with no in-app way back.
      const row = await db.membership.findFirst({ where: { id, workspaceId }, select: { role: true } });
      if (!row) return;
      if (row.role === "ADMIN") {
        const admins = await db.membership.count({ where: { workspaceId, role: "ADMIN", status: "active" } });
        if (admins <= 1) throw new Error("This is the workspace's only admin — promote someone else first, or the workspace would be left with nobody who can administer it.");
      }
      await db.membership.deleteMany({ where: { id, workspaceId } });
    },
    revalidate: ["/admin"],
  },

  zernioAccount: {
    label: "connected account",
    role: "ADMIN",
    find: (id, workspaceId) => db.zernioAccount.findFirst({ where: { id, workspaceId }, select: { id: true, platform: true } })
      .then((r) => (r ? { id: r.id, name: r.platform } : null)),
    async remove(id, workspaceId) { await db.zernioAccount.deleteMany({ where: { id, workspaceId } }); },
    revalidate: ["/admin/connections", "/social"],
  },

  workspace: {
    label: "workspace",
    role: "ADMIN",
    typeToConfirm: true,
    // The id IS the workspace, so "scoped to the caller's workspace" means the
    // caller must be an admin OF THE ONE THEY'RE DELETING — enforced by the
    // action resolving membership for this id before calling in.
    find: (id, workspaceId) => (id === workspaceId
      ? db.workspace.findUnique({ where: { id }, select: { id: true, name: true } })
      : Promise.resolve(null)),
    async impact(id) {
      const [channels, posts, members, settings, topics] = await Promise.all([
        db.channel.count({ where: { workspaceId: id } }),
        db.blogPost.count({ where: { workspaceId: id } }),
        db.membership.count({ where: { workspaceId: id } }),
        db.workspaceSetting.count({ where: { workspaceId: id } }),
        db.topic.count({ where: { workspaceId: id } }),
      ]);
      return nonZero([
        ["channels (and everything under them)", channels], ["blog posts", posts],
        ["members", members], ["saved API keys / settings", settings], ["topics", topics],
      ]);
    },
    async remove(id, workspaceId) {
      if (id !== workspaceId) return;
      await db.workspace.delete({ where: { id } });
    },
    redirectTo: () => "/settings",
    revalidate: ["/settings", "/"],
  },
};

export function isDeletableKind(v: string): v is DeletableKind {
  return Object.prototype.hasOwnProperty.call(DELETABLE, v);
}

/**
 * Impact preview for the confirmation UI — what else goes when this goes.
 *
 * Deliberately NOT a server action: it would then be callable from any client
 * with any workspaceId, handing out row counts for other companies. Server
 * components call it directly with the workspace they already authenticated.
 * Returns [] rather than throwing, so a counting bug can never stop the delete
 * button rendering.
 */
export async function deletionImpact(kind: DeletableKind, id: string, workspaceId: string): Promise<Array<[string, number]>> {
  try {
    return (await DELETABLE[kind].impact?.(id, workspaceId)) ?? [];
  } catch {
    return [];
  }
}
