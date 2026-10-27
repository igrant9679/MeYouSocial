import { db } from "@/lib/db";

/**
 * One item attached to a canvas chat, as the text the model reads — or a plain
 * note of why it can't be read. A bare URL or a research id gave the model
 * nothing to read, so it wrote as if it had (ENG-14).
 */
export async function contextText(c: { kind: string; ref: string }, workspaceId: string): Promise<string> {
  if (c.kind === "text") return `[pasted text]\n${c.ref.slice(0, 4000)}`;
  if (c.kind === "upload") {
    const src = await db.researchSource.findFirst({ where: { id: c.ref, channel: { workspaceId } }, select: { title: true, content: true } });
    if (!src) return "[upload] (no longer available)";
    return src.content
      ? `[upload: ${src.title ?? "file"}]\n${src.content.slice(0, 4000)}`
      : `[upload: ${src.title ?? "file"}] (stored without readable text — don't describe its contents)`;
  }
  if (c.kind === "web_url" || c.kind === "youtube_url") {
    const { fetchPageText } = await import("@/lib/assistant/context");
    const page = await fetchPageText(c.ref, 4000);
    const label = c.kind === "web_url" ? "web page" : "YouTube video";
    if (!page.ok) return `[${label}] ${c.ref} (couldn't be read: ${page.reason} — don't describe it)`;
    // A YouTube watch page carries its title, not the transcript.
    return c.kind === "youtube_url"
      ? `[${label}] ${c.ref}\nTitle: ${page.title || "(none)"} (transcript not read — don't quote the video)`
      : `[${label}] ${c.ref}\n${page.title ? `Title: ${page.title}\n` : ""}${page.text}`;
  }
  return `[${c.kind}] ${c.ref}`;
}
