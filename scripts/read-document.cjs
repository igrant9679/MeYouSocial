// Reads one PDF or Word file into plain text (E-ENG-13), in a process of its own.
//
//   node --max-old-space-size=N scripts/read-document.cjs <pdf|word> <input> <output>
//   node scripts/read-document.cjs --self-check
//
// ⚠ NOT part of the Next bundle, and nothing in the app imports these parsers:
// src/lib/documents/read.ts starts this file with a heap cap, a time limit and an
// environment holding no secrets. An uploaded file is hostile until proven
// otherwise, and a page-heavy PDF is minutes of solid CPU — here a crash, a hang
// or a memory blow-up costs one reading, not the app everyone is using.
//
// The text goes to <output>; one line of JSON on stdout says what happened:
//   { "ok": true, "pages": 12, "rssMb": 180 }
//   { "ok": false, "reason": "encrypted" | "damaged" | "too-big", "detail": "…" }
/* eslint-disable @typescript-eslint/no-require-imports -- a plain script node starts directly, outside the bundle */
const fs = require("node:fs");

const WORD_BODY_MAX = 256 * 1024 * 1024; // word/document.xml unpacked — past this it's a zip bomb, not a document

const say = (o) => process.stdout.write(JSON.stringify({ ...o, rssMb: Math.round(process.resourceUsage().maxRSS / 1024) }) + "\n");

async function readPdf(data) {
  const { PDFParse } = require("pdf-parse");
  // isEvalSupported: a font must never become code (the pdf.js CVE-2024-4367 family).
  const parser = new PDFParse({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    return { text: result.pages.map((p) => p.text.trim()).filter(Boolean).join("\n\n"), pages: result.total };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** The size word/document.xml says it unpacks to, from the zip's central directory; null when there's no such entry. */
function wordBodySize(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65_535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === "word/document.xml") return buf.readUInt32LE(p + 24);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return null;
}

async function readWord(buffer) {
  const size = wordBodySize(buffer);
  if (size === null) throw Object.assign(new Error("no document body — it may be an old .doc renamed to .docx"), { reason: "damaged" });
  if (size > WORD_BODY_MAX) throw Object.assign(new Error(`its text unpacks to ${Math.round(size / 1048576)} MB`), { reason: "too-big" });
  const mammoth = require("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return { text: value.trim(), pages: null };
}

function reasonFor(e) {
  if (e?.reason) return e.reason;
  if (e?.name === "PasswordException" || /password/i.test(e?.message ?? "")) return "encrypted";
  return "damaged";
}

/** Reads a small PDF and a small Word file made here — so a deploy can prove the parsers load on its own machine. */
async function selfCheck() {
  const stream = "BT /F1 18 Tf 20 100 Td (reader self check) Tj ET";
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n` +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n",
  );
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>reader self check</w:t></w:r></w:p></w:body></w:document>');
  const a = await readPdf(pdf);
  const b = await readWord(await zip.generateAsync({ type: "nodebuffer" }));
  const ok = /reader self check/.test(a.text) && /reader self check/.test(b.text);
  say({ ok, node: process.version, pdf: a.text.slice(0, 40), word: b.text.slice(0, 40) });
}

async function main() {
  if (process.argv[2] === "--self-check") return selfCheck();
  const [kind, input, output] = process.argv.slice(2);
  const data = fs.readFileSync(input);
  const out = kind === "pdf" ? await readPdf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) : await readWord(data);
  fs.writeFileSync(output, out.text);
  say({ ok: true, pages: out.pages });
}

main().then(
  () => process.exit(0),
  (e) => { say({ ok: false, reason: reasonFor(e), detail: String(e?.message ?? e).slice(0, 300) }); process.exit(0); },
);
