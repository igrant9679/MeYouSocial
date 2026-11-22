import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { storage } from "@/lib/storage";
import { tagLinksForNetwork } from "@/lib/social/utm";
import { splitLinks, supportsFirstComment } from "@/lib/social/platform-options";
import type { PreviewPost } from "@/components/PostPreview";

type PostForPreview = {
  workspaceId: string;
  text: string;
  mediaKeys: string;
  firstComment: string | null;
  linkToFirstComment: boolean;
  campaign: { utmCampaign: string | null } | null;
  targets: Array<{ provider: string; accountId: string; accountName: string | null; text: string | null; mediaKeys: string | null; firstComment: string | null; subFormat: string | null }>;
};

/**
 * "Preview as posted" for a saved post's own page (2026-11-21): one entry per network leg, each built the way
 * lib/social/publish.ts builds the send — the leg's own text else the post's, links tagged for that network (the
 * campaign's tag first), the first comment (the leg's own else the post's), and "move links to the first comment"
 * applied after tagging where a first comment exists. ⚠ Change publish.ts's arithmetic and change this with it.
 * Tags use today's link settings: a post sent before they changed went out with the settings of its day.
 */
export async function previewPostsFor(post: PostForPreview): Promise<PreviewPost[]> {
  const baseKeys = readJson<string[]>(post.mediaKeys, []);
  const allKeys = [...new Set([...baseKeys, ...post.targets.flatMap((t) => (t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : []))])];
  const [accounts, items] = await Promise.all([
    db.zernioAccount.findMany({
      where: { workspaceId: post.workspaceId, accountId: { in: post.targets.map((t) => t.accountId) } },
      select: { accountId: true, displayName: true, username: true },
    }),
    allKeys.length ? db.mediaItem.findMany({ where: { workspaceId: post.workspaceId, key: { in: allKeys } }, select: { key: true, contentType: true } }) : Promise.resolve([]),
  ]);
  const byAccount = new Map(accounts.map((a) => [a.accountId, a]));
  const videoKey = new Map(items.map((m) => [m.key, (m.contentType ?? "").startsWith("video/")]));
  const isVideo = (k: string) => videoKey.get(k) ?? /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(k);
  const media = (keys: string[]) => keys.slice(0, 4).map((k) => ({ url: storage.url(k), video: isVideo(k) }));
  const utm = post.campaign?.utmCampaign;

  const out: PreviewPost[] = [];
  for (const t of post.targets) {
    let text = await tagLinksForNetwork(t.text ?? post.text, post.workspaceId, t.provider, utm);
    const own = (t.firstComment ?? post.firstComment ?? "").trim();
    const takes = supportsFirstComment(t.provider, t.subFormat);
    let comment = own && takes ? await tagLinksForNetwork(own, post.workspaceId, t.provider, utm) : null;
    if (post.linkToFirstComment && takes) {
      const { caption, links } = splitLinks(text);
      if (links.length && caption) {
        text = caption;
        comment = [links.join("\n"), comment].filter(Boolean).join("\n\n");
      }
    }
    const ownKeys = t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : [];
    const account = byAccount.get(t.accountId);
    out.push({
      provider: t.provider,
      accountName: account?.displayName ?? account?.username ?? t.accountName,
      handle: account?.username ?? null,
      text,
      comment,
      media: media(ownKeys.length ? ownKeys : baseKeys),
      subFormat: t.subFormat === "story" || t.subFormat === "reel" ? t.subFormat : null,
    });
  }
  return out;
}
