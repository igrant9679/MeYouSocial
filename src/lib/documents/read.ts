import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A PDF or Word file → plain text (E-ENG-13), in a process of its own
 * (`scripts/read-document.cjs`): a heap cap, a time limit, no secrets in its
 * environment, and one at a time. Never throws; a file that can't be read comes
 * back with the reason, in words a person can act on.
 *
 * Measured: a 252 MB PDF peaks at 345 MB (the file, plus about 100 MB) and 1,500
 * pages of text at 160 MB — so the limit on what's read is the file's size.
 */

/** Past this a file is kept but not read: its bytes alone would be this much memory. */
export const READ_MAX_BYTES = 512 * 1024 * 1024;
/** What's kept of a file's text — about 170,000 words. A longer one says so. */
export const TEXT_MAX_CHARS = 1_000_000;

const READ_TIMEOUT_MS = 5 * 60_000;
const HEAP_MB = 1024;
const SCRIPT = () => path.join(process.cwd(), "scripts", "read-document.cjs");

export type DocumentReading =
  | { ok: true; text: string; totalChars: number; pages: number | null }
  | { ok: false; reason: "encrypted" | "damaged" | "too-big" | "failed"; detail?: string };

// Reads queue behind one another: two big PDFs at once is two big PDFs in memory.
let turn: Promise<unknown> = Promise.resolve();

/** The environment a parser runs in: enough to start node, and nothing worth stealing. */
function bareEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME"];
  return { NODE_ENV: "production", ...Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
}

function runReader(args: string[], timeout: number): Promise<{ line: string | null; failed: boolean }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [`--max-old-space-size=${HEAP_MB}`, SCRIPT(), ...args], { timeout, maxBuffer: 1024 * 1024, env: bareEnv() }, (err, stdout) => {
      const line = String(stdout ?? "").trim().split(/\r?\n/).pop() || null;
      resolve({ line, failed: !!err });
    });
  });
}

export function readDocumentFile(kind: "pdf" | "word", file: string): Promise<DocumentReading> {
  const run = turn.then(() => readOne(kind, file));
  turn = run.catch(() => undefined);
  return run;
}

async function readOne(kind: "pdf" | "word", file: string): Promise<DocumentReading> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mys-read-"));
  const output = path.join(dir, "text.txt");
  try {
    const { line, failed } = await runReader([kind, file, output], READ_TIMEOUT_MS);
    let meta: { ok?: boolean; reason?: string; detail?: string; pages?: number | null } | null = null;
    try {
      meta = line ? JSON.parse(line) : null;
    } catch {
      meta = null;
    }
    // Killed: out of time or out of memory. It said nothing, or nothing useful.
    if (!meta || (failed && !meta.ok)) return { ok: false, reason: "failed" };
    if (!meta.ok) {
      const reason = meta.reason === "encrypted" || meta.reason === "too-big" ? meta.reason : "damaged";
      return { ok: false, reason, detail: meta.detail };
    }
    const text = await fs.readFile(output, "utf8");
    return { ok: true, text: text.slice(0, TEXT_MAX_CHARS), totalChars: text.length, pages: meta.pages ?? null };
  } catch (e) {
    return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : undefined };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The same, from bytes already in hand. */
export async function readDocumentBytes(kind: "pdf" | "word", bytes: Buffer): Promise<DocumentReading> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mys-read-"));
  const file = path.join(dir, "in.bin");
  try {
    await fs.writeFile(file, bytes);
    return await readDocumentFile(kind, file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Prove the parsers load on THIS machine, once at boot. They carry a native part
 * and want a recent node, neither of which a build on another computer can vouch
 * for — and without this the first person to learn they don't work is someone
 * attaching a file. Kept as a Setting so a deploy check can read it.
 */
export async function recordReaderCheck(): Promise<void> {
  const { line } = await runReader(["--self-check"], 60_000);
  let value = { ok: false, detail: "the reader printed nothing" } as Record<string, unknown>;
  try {
    if (line) value = JSON.parse(line);
  } catch {
    value = { ok: false, detail: line?.slice(0, 200) };
  }
  const stamped = JSON.stringify({ ...value, at: new Date().toISOString() });
  if (value.ok) console.log(`[documents] reader check passed on node ${String(value.node)}`);
  else console.error(`[documents] reader check FAILED — PDF and Word files can't be read: ${stamped}`);
  const { db } = await import("@/lib/db");
  await db.setting.upsert({ where: { key: "documents:reader_check" }, update: { value: stamped }, create: { key: "documents:reader_check", value: stamped } });
}
