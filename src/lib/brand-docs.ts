import { inflateRawSync } from "node:zlib";
import { getApiKey } from "@/lib/llm/keys";

/**
 * Brand documents → plain text, so a positioning deck or style guide can ground
 * every generation in this workspace.
 *
 * ⚠ THE RULE HERE IS THE MOCK-FALLBACK RULE. A document that stores fine and
 * contributes nothing is success-shaped failure: the owner uploads their brand
 * guide, the UI says "uploaded", and every prompt afterwards is exactly as
 * uninformed as before. So extraction either produces text or produces a
 * NAMED REASON, never silence. `BrandDocument.text = null` always has
 * `extractError` beside it, and the UI shows it.
 *
 * Formats, and why each is done this way:
 *   - **text/markdown/csv** — decoded directly. Exact, no dependency, no cost.
 *   - **DOCX** — a .docx IS a zip holding `word/document.xml`. Read with a
 *     ~50-line central-directory walk + `inflateRawSync`, in the same spirit as
 *     the hand-written gdrive and Zernio clients: one predictable format
 *     against Node's own zlib beats another package in the bundle graph.
 *   - **PDF** — no deterministic path without a parser dependency, so this one
 *     goes to Gemini (which reads PDFs natively) in a BACKGROUND JOB. Slow,
 *     costs a call, and can fail — hence the `extracting` state and an honest
 *     error rather than an empty document that looks fine.
 *   - **Pasted text** — always available, and the answer for anything else.
 *     A format we can't read is refused AT UPLOAD with that advice, instead of
 *     being stored as a decoration.
 */

export const BRAND_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** Hard cap per document. Long enough for a real brand guide, short enough that
 *  one document can't eat a whole prompt. Truncation is always disclosed. */
export const BRAND_DOC_MAX_CHARS = 20_000;

type Format = "text" | "docx" | "pdf";

const FORMATS: Record<string, Format> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/rtf": "text", // tag-stripped below; crude but readable
  "text/rtf": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/pdf": "pdf",
};

const EXT_FORMATS: Record<string, Format> = {
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".csv": "text",
  ".rtf": "text",
  ".docx": "docx",
  ".pdf": "pdf",
};

/** Browsers lie about MIME as often as not (`application/octet-stream` for a
 *  .docx is routine), so the extension gets a vote too. */
export function brandDocFormat(name: string, mimeType: string | null | undefined): Format | null {
  const byMime = mimeType ? FORMATS[mimeType.split(";")[0].trim().toLowerCase()] : undefined;
  if (byMime) return byMime;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_FORMATS[name.slice(dot).toLowerCase()] ?? null;
}

/** True when reading this format needs the `brand.extractdoc` job (an LLM call). */
export function brandDocNeedsJob(format: Format): boolean {
  return format === "pdf";
}

export const BRAND_DOC_ACCEPT = ".txt,.md,.markdown,.csv,.rtf,.docx,.pdf";

export type ExtractResult = { text: string; truncated: boolean } | { error: string };

// ── ZIP (DOCX) ───────────────────────────────────────────────────────────────

/**
 * Read ONE named entry out of a zip archive. Central-directory walk, because
 * scanning for local headers misreads any file whose data happens to contain
 * the signature bytes.
 */
function readZipEntry(buf: Buffer, wanted: string): Buffer | null {
  // End of central directory: signature, then a comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65_535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === wanted) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      // The LOCAL header's own name/extra lengths decide where data starts —
      // they differ from the central directory's more often than you'd think.
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null; // some other compression method — not worth guessing
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " ",
};

function xmlToText(xml: string): string {
  return xml
    // Word marks paragraphs and breaks with elements, not whitespace.
    .replace(/<w:p[ >][^>]*>|<w:p\/>|<w:p>/g, "\n")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<w:tab\s*\/?>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** RTF, crudely: drop control words and groups. Good enough to read prose. */
function rtfToText(raw: string): string {
  return raw
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clean(raw: string): ExtractResult {
  // Strip control characters (a binary file decoded as text is mostly these) —
  // if what's left is too short to be prose, say so instead of storing noise.
  const text = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/�/g, "") // bytes that were never UTF-8 at all
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 20) {
    return { error: "No readable text found in that file. Paste the text instead, or upload a .docx/.txt/.md." };
  }
  const truncated = text.length > BRAND_DOC_MAX_CHARS;
  return { text: truncated ? text.slice(0, BRAND_DOC_MAX_CHARS) : text, truncated };
}

/**
 * Extract without any network call. Returns null for formats that need the job
 * (PDF), so the caller can enqueue instead of guessing.
 */
export function extractBrandDocSync(name: string, mimeType: string | null, bytes: Buffer): ExtractResult | null {
  const format = brandDocFormat(name, mimeType);
  if (!format) {
    return { error: "That file type can't be read. Upload .docx, .pdf, .txt, .md, .csv or .rtf — or paste the text." };
  }
  if (format === "pdf") return null;
  if (format === "docx") {
    let xml: Buffer | null;
    try {
      xml = readZipEntry(bytes, "word/document.xml");
    } catch (e) {
      return { error: `That .docx couldn't be unpacked (${e instanceof Error ? e.message : "unknown error"}). Paste the text instead.` };
    }
    if (!xml) {
      return { error: "That .docx has no readable document body — if it was saved as .doc and renamed, re-save it as .docx." };
    }
    return clean(xmlToText(xml.toString("utf8")));
  }
  const raw = bytes.toString("utf8");
  return clean(/^\s*{\\rtf/i.test(raw) ? rtfToText(raw) : raw);
}

// ── PDF, via Gemini ──────────────────────────────────────────────────────────

/**
 * ⚠ Model id is `gemini-flash-latest` on purpose. Five separate ids this key
 * ADVERTISED have 404'd when called (see CLAUDE.md) — the `-latest` aliases are
 * the ones proven against the live key.
 */
const PDF_MODEL = "gemini-flash-latest";

const PDF_PROMPT =
  "Transcribe this document's text content in reading order as plain text. Preserve headings and list structure with simple markdown. Do not summarise, do not comment, do not add anything that is not in the document. If a page is an image with no text, write nothing for it.";

/**
 * Read a PDF by asking Gemini to transcribe it. Throws with a human reason —
 * the caller records it in `extractError` so the document says why it's empty.
 */
export async function extractBrandDocPdf(bytes: Buffer, workspaceId: string): Promise<ExtractResult> {
  const key = await getApiKey("google", workspaceId).catch(() => "");
  if (!key) {
    return { error: "Reading a PDF needs a Google API key for this workspace (Admin → API keys). Paste the text, or upload .docx, instead." };
  }
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const out = await ai.models.generateContent({
      model: PDF_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } },
            { text: PDF_PROMPT },
          ],
        },
      ],
    });
    const text = (out.text ?? "").trim();
    if (!text) return { error: "The PDF reader returned nothing — it may be a scan with no text layer. Paste the text instead." };
    return clean(text);
  } catch (e) {
    return { error: `The PDF couldn't be read: ${e instanceof Error ? e.message.slice(0, 300) : "unknown error"}` };
  }
}
