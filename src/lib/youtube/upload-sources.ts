import { db } from "@/lib/db";
import { keyFromStoredUrl, videoTypeOf } from "@/lib/youtube/upload";

export type UploadSource = { value: string; key: string; name: string; label: string };

/**
 * What a project can upload (E-VID-03): its own video files — Assets linked to
 * it (a take recorded at the teleprompter lands there) and the stitched cut or
 * clip of a render made from its script — and its own images for a thumbnail
 * (the script's Thumbnail Studio renders and image Assets on the project).
 * Only files the app stores; a link to elsewhere can't be sent.
 */
export async function projectUploadSources(workspaceId: string, projectId: string, scriptId: string | null): Promise<{ videos: UploadSource[]; images: UploadSource[] }> {
  const [links, renders, thumbs] = await Promise.all([
    db.assetLink.findMany({ where: { contentProjectId: projectId, asset: { OR: [{ workspaceId }, { workspaceId: null }] } }, select: { asset: { select: { id: true, name: true, uploadKey: true } } } }),
    scriptId ? db.videoRender.findMany({ where: { workspaceId, scriptId, status: "done" }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, title: true, assembledUrl: true, storedUrl: true } }) : Promise.resolve([]),
    scriptId ? db.thumbnail.findMany({ where: { scriptId, channel: { workspaceId }, renderUrl: { not: null } }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, renderUrl: true } }) : Promise.resolve([]),
  ]);
  const videos: UploadSource[] = [];
  const images: UploadSource[] = [];
  for (const { asset } of links) {
    if (!asset.uploadKey) continue;
    if (videoTypeOf(asset.name)) videos.push({ value: `asset:${asset.id}`, key: asset.uploadKey, name: asset.name, label: `Asset — ${asset.name}` });
    else if (/\.(png|jpe?g)$/i.test(asset.name)) images.push({ value: `asset:${asset.id}`, key: asset.uploadKey, name: asset.name, label: `Asset — ${asset.name}` });
  }
  for (const r of renders) {
    const cut = keyFromStoredUrl(r.assembledUrl);
    const clip = keyFromStoredUrl(r.storedUrl);
    if (cut) videos.push({ value: `render:${r.id}:cut`, key: cut, name: `${r.title}.mp4`, label: `Storyboard cut — ${r.title}` });
    else if (clip) videos.push({ value: `render:${r.id}:clip`, key: clip, name: `${r.title}.mp4`, label: `Rendered clip — ${r.title}` });
  }
  for (const t of thumbs) {
    const key = keyFromStoredUrl(t.renderUrl);
    if (key) images.push({ value: `thumb:${t.id}`, key, name: `${t.title ?? "thumbnail"}.png`, label: `Thumbnail — ${t.title ?? "untitled"}` });
  }
  return { videos, images };
}
