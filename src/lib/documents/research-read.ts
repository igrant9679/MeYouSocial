import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { formatBytes, uploadKind, type UploadKind } from "@/lib/documents/kinds";
import { READ_MAX_BYTES, readDocumentFile, TEXT_MAX_CHARS, type DocumentReading } from "@/lib/documents/read";

/**
 * Read an attached file into its ResearchSource (E-ENG-13). Text is decoded; a PDF
 * or Word file goes to the reader; an image is looked at by a vision model. Every
 * exit writes text or a note saying why there is none, in words a person can act
 * on: a file that stores fine and tells the assistant nothing, silently, is the
 * failure this exists to end. ⚠ Nothing here makes up content — the old stand-in
 * sentence for a PDF reached the model as research (ENG-14).
 */

const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
/** Vision providers take about 20 MB once encoded; a bigger picture is resized first, and loses nothing a description needs. */
const IMAGE_SEND_BYTES = 4 * 1024 * 1024;
const TEXT_HEAD_BYTES = 4 * 1024 * 1024;

type Outcome = { text: string | null; words?: number; state: "ready" | "failed"; note: string | null };

const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const sentence = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

function noteForReading(r: Exclude<DocumentReading, { ok: true }>, what: string): string {
  if (r.reason === "encrypted") return `Saved, but not read: this ${what} is protected by a password. Remove the password and attach it again.`;
  if (r.reason === "too-big") return `Saved, but not read: its text unpacks to more than the reader will take (${r.detail ?? "too large"}).`;
  if (r.reason === "damaged") return `Saved, but not read: the file looks damaged, or isn't really a ${what}${r.detail ? ` (${sentence(r.detail)})` : ""}.`;
  return "Saved, but not read: it took longer than five minutes, or more memory than the reader gets. Attach the part you need as a smaller file.";
}

function outcomeFromText(text: string, totalChars: number, pages: number | null): Outcome {
  const words = countWords(text);
  const part = totalChars > TEXT_MAX_CHARS
    ? `Only the first ${TEXT_MAX_CHARS.toLocaleString("en-US")} of its ${totalChars.toLocaleString("en-US")} characters were kept${pages ? ` (it has ${pages.toLocaleString("en-US")} pages)` : ""}. Attach the part you need as a smaller file to read the rest.`
    : null;
  return { text, words, state: "ready", note: part };
}

async function readPdfOrWord(kind: "pdf" | "word", key: string, workspaceId: string, name: string): Promise<Outcome> {
  const what = kind === "pdf" ? "PDF" : "Word document";
  const local = await storage.fileOnDisk(key, READ_MAX_BYTES);
  if (local === "too-big") return { text: null, state: "failed", note: `Saved, but not read: it's over the ${formatBytes(READ_MAX_BYTES)} the app can read. Attach the part you need as a smaller file.` };
  if (!local) return { text: null, state: "failed", note: "Saved, but not read: the stored file couldn't be fetched back from storage. Press Read again in a little while." };
  try {
    const reading = await readDocumentFile(kind, local.path);
    if (!reading.ok) return { text: null, state: "failed", note: noteForReading(reading, what) };
    if (reading.text.trim()) return outcomeFromText(reading.text, reading.totalChars, reading.pages);
    if (kind === "word") return { text: null, state: "failed", note: "Saved, but not read: this document has no text in it." };
    // No text layer: a scan. Gemini can read one, where a Google key is set.
    const stat = await fs.stat(local.path);
    const { extractBrandDocPdf, PDF_INLINE_MAX_BYTES } = await import("@/lib/brand-docs");
    if (stat.size > PDF_INLINE_MAX_BYTES) return { text: null, state: "failed", note: `Saved, but not read: this PDF is a scan with no text in it, and at ${formatBytes(stat.size)} it's too large to send for reading (the limit is ${formatBytes(PDF_INLINE_MAX_BYTES)}).` };
    const scan = await extractBrandDocPdf(await fs.readFile(local.path), workspaceId, { scanOnly: true });
    if ("error" in scan) return { text: null, state: "failed", note: `Saved, but not read: this PDF is a scan with no text in it. ${scan.error}` };
    return { text: scan.text, state: "ready", note: `${name.slice(0, 60)} is a scan, so a model transcribed it${scan.truncated ? " — the first 20,000 characters" : ""}; check anything exact against the original.` };
  } finally {
    await local.done();
  }
}

async function readText(key: string): Promise<Outcome> {
  const head = await storage.head(key, TEXT_HEAD_BYTES);
  if (!head) return { text: null, state: "failed", note: "Saved, but not read: the stored file couldn't be fetched back from storage. Press Read again in a little while." };
  // A cut can land inside a character; the replacement that makes stays out of what's kept.
  const raw = head.toString("utf8").replace(/�+$/, "");
  const cut = head.length === TEXT_HEAD_BYTES;
  const text = raw.slice(0, TEXT_MAX_CHARS);
  return {
    text,
    state: "ready",
    note: cut || raw.length > TEXT_MAX_CHARS ? `Only the first ${text.length.toLocaleString("en-US")} characters were kept. Attach the part you need as a smaller file to read the rest.` : null,
  };
}

async function readImage(key: string, contentType: string, workspaceId: string, name: string, bytesKnown: number | null): Promise<Outcome> {
  if (bytesKnown != null && bytesKnown > IMAGE_MAX_BYTES) return { text: null, state: "failed", note: `Saved, but not described: it's over the ${formatBytes(IMAGE_MAX_BYTES)} the app can look at.` };
  const bytes = await storage.get(key);
  if (!bytes) return { text: null, state: "failed", note: "Saved, but not described: the stored file couldn't be fetched back from storage. Press Read again in a little while." };
  let send = bytes;
  let mimeType = contentType;
  if (bytes.byteLength > IMAGE_SEND_BYTES) {
    const sharp = (await import("sharp")).default;
    try {
      send = await sharp(bytes).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      mimeType = "image/jpeg";
    } catch {
      return { text: null, state: "failed", note: "Saved, but not described: the picture couldn't be opened — it may be damaged." };
    }
  }
  const { getApiKey } = await import("@/lib/llm/keys");
  const [google, openai] = await Promise.all([getApiKey("google", workspaceId).catch(() => ""), getApiKey("openai", workspaceId).catch(() => "")]);
  if (!google && !openai) return { text: null, state: "failed", note: "Saved without a description: no vision-capable key (Google or OpenAI) is set for this workspace, so nothing looked at it." };
  try {
    const { askAboutImage } = await import("@/lib/vision");
    const text = (await askAboutImage(
      { bytes: send, mimeType, source: name },
      "Describe what this image shows in one or two plain sentences. Name only what is visible; don't guess at brands, people or places you can't see.",
      workspaceId,
    )).slice(0, 600);
    return { text, state: "ready", note: null };
  } catch (e) {
    // A key that exists and was refused (out of credits, say) isn't "no key".
    return { text: null, state: "failed", note: `Saved without a description: the vision provider didn't answer (${sentence(e instanceof Error ? e.message : "no detail")}). Press Read again once it's sorted.` };
  }
}

/** Read one source and write what came of it. Never throws. */
export async function readResearchSource(id: string, actorId: string | null): Promise<void> {
  const source = await db.researchSource.findUnique({
    where: { id },
    select: { id: true, kind: true, ref: true, title: true, bytes: true, readState: true, channel: { select: { workspaceId: true } } },
  });
  if (!source || !["reading", "unread"].includes(source.readState)) return;
  const workspaceId = source.channel.workspaceId;
  const name = source.title ?? "file";
  const kind = source.kind as UploadKind;
  const contentType = uploadKind(name, "")?.contentType ?? "image/jpeg";
  let out: Outcome;
  try {
    out = kind === "pdf" || kind === "word"
      ? await readPdfOrWord(kind, source.ref, workspaceId, name)
      : kind === "text"
        ? await readText(source.ref)
        : await readImage(source.ref, contentType, workspaceId, name, source.bytes == null ? null : Number(source.bytes));
  } catch (e) {
    out = { text: null, state: "failed", note: `Saved, but not read: ${sentence(e instanceof Error ? e.message : "something went wrong")}. Press Read again to try once more.` };
  }
  const words = out.words ?? (out.text ? countWords(out.text) : 0);
  await db.researchSource.update({
    where: { id },
    data: { content: out.text, wordCount: words, readState: out.state, readNote: out.note },
  });
  // A chat's chip shows the words; it was written before they were known.
  const chips = await db.chatContext.findMany({ where: { kind: "upload", ref: id }, select: { id: true, metadata: true } });
  for (const c of chips) {
    const meta = (() => { try { return JSON.parse(c.metadata ?? "{}") as Record<string, unknown>; } catch { return {}; } })();
    await db.chatContext.update({ where: { id: c.id }, data: { metadata: JSON.stringify({ ...meta, words }) } });
  }
  await db.usageLog.create({ data: { workspaceId, actorId, action: "upload", words } });
}
