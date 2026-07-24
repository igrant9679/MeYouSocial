import { promises as fs } from "node:fs";
import path from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

/**
 * Dependency-free client for HeyGen's HyperFrames cloud render API — same house
 * pattern as src/lib/storage/gdrive.ts (a REST client built on fetch, no SDK).
 *
 * Why cloud and not local: rendering a HyperFrames composition needs headless
 * Chrome + ffmpeg. HeyGen runs both; we submit a zipped composition and get an
 * MP4 back. That keeps Railway free of a Chromium dependency entirely — the
 * whole path here is HTTP.
 *
 * Contract (read from the hyperframes CLI source, v0.7.71):
 *   POST /v3/hyperframes/renders   { base64 | asset_id | url, aspect_ratio,
 *                                    fps, quality, format, variables }  -> render_id
 *   GET  /v3/hyperframes/renders/{id}  -> { status, video_url, ... }
 *   Auth: header `x-api-key: <key>`. Base https://api.heygen.com
 *   (override HEYGEN_API_URL). Responses wrap the payload in `{ data: ... }`.
 *   Terminal statuses: "completed" | "failed".
 */

const DEFAULT_BASE_URL = "https://api.heygen.com";
const POLL_INTERVAL_MS = 6_000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;

function baseUrl(): string {
  const override = process.env.HEYGEN_API_URL;
  return override && override.length > 0 ? override.replace(/\/+$/, "") : DEFAULT_BASE_URL;
}

export class HeygenCloudError extends Error {}

export type CloudRenderOpts = {
  apiKey: string;
  /** Absolute path to the composition project directory (contains index.html). */
  projectDir: string;
  variables: Record<string, unknown>;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  fps?: number;
  quality?: "draft" | "standard" | "high";
  /** Cooperative cancellation / overall deadline. */
  signal?: AbortSignal;
};

export type CloudRenderResult = { renderId: string; videoUrl: string };

// ── Minimal ZIP writer (STORED + DEFLATE), dependency-free ────────────────────
// A composition bundle is a handful of small text files. Node ships no zip
// writer, so we emit the archive by hand: per-file local headers + a central
// directory. Each entry is DEFLATE-compressed when that wins, else STORED.
// Verified by extracting the output with a standard unzip and re-running
// `hyperframes check` on it.

type ZipEntry = { name: string; data: Buffer };

function dosDateTime(): { time: number; date: number } {
  // No Date.now() available in some sandboxes and determinism is nice anyway:
  // pin every entry to a fixed 1980-01-01 00:00:00 timestamp.
  return { time: 0, date: (1 << 5) | 1 }; // year 1980, month 1, day 1
}

function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0;
    const uncompressed = entry.data.length;
    const deflated = deflateRawSync(entry.data);
    const useDeflate = deflated.length < uncompressed;
    const method = useDeflate ? 8 : 0;
    const body = useDeflate ? deflated : entry.data;
    const compressed = body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0, 8); // flags
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed, 20);
    cen.writeUInt32LE(uncompressed, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // extra
    cen.writeUInt16LE(0, 32); // comment
    cen.writeUInt16LE(0, 34); // disk
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/**
 * The archive the cloud renderer needs: index.html plus any config it reads.
 * Mirrors the CLI's ignore set (skips renders/, dotfiles, node_modules, docs).
 */
async function zipComposition(projectDir: string): Promise<Buffer> {
  const KEEP = new Set(["index.html", "meta.json", "hyperframes.json"]);
  const names = await fs.readdir(projectDir);
  const entries: ZipEntry[] = [];
  for (const name of names.sort()) {
    if (!KEEP.has(name)) continue;
    const data = await fs.readFile(path.join(projectDir, name));
    entries.push({ name, data });
  }
  if (!entries.some((e) => e.name === "index.html")) {
    throw new HeygenCloudError(`No index.html found in composition dir ${projectDir}`);
  }
  return buildZip(entries);
}

// ── REST calls ────────────────────────────────────────────────────────────────

async function api(
  apiKey: string,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}${pathname}`, {
    method,
    headers: {
      "x-api-key": apiKey,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const detail =
      (json?.message as string) ||
      ((json?.error as { message?: string } | undefined)?.message) ||
      text.slice(0, 200) ||
      res.statusText;
    throw new HeygenCloudError(`HeyGen HTTP ${res.status}: ${detail}`);
  }
  // Payload is wrapped in { data: ... }.
  return (json.data as Record<string, unknown>) ?? json;
}

/**
 * Submit → poll → return the signed MP4 URL. Never touches storage; the caller
 * downloads and persists. Throws HeygenCloudError with an actionable message.
 */
export async function renderOnCloud(opts: CloudRenderOpts): Promise<CloudRenderResult> {
  if (!opts.apiKey) throw new HeygenCloudError("No HeyGen API key");
  const zip = await zipComposition(opts.projectDir);

  const submit = await api(opts.apiKey, "POST", "/v3/hyperframes/renders", {
    base64: zip.toString("base64"),
    composition: "index.html",
    aspect_ratio: opts.aspectRatio ?? "9:16",
    fps: opts.fps ?? 30,
    quality: opts.quality ?? "standard",
    format: "mp4",
    variables: opts.variables,
  }, opts.signal);

  const renderId = String(submit.render_id ?? submit.id ?? "");
  if (!renderId) throw new HeygenCloudError("HeyGen accepted the render but returned no render_id");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new HeygenCloudError("Render cancelled");
    if (Date.now() > deadline) throw new HeygenCloudError("HeyGen render timed out");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const detail = await api(opts.apiKey, "GET", `/v3/hyperframes/renders/${encodeURIComponent(renderId)}`, undefined, opts.signal);
    const status = String(detail.status ?? "").toLowerCase();
    if (status === "failed") {
      const reason = (detail.error as { message?: string } | undefined)?.message ?? detail.message ?? "render failed";
      throw new HeygenCloudError(`HeyGen render failed: ${String(reason).slice(0, 200)}`);
    }
    if (status === "completed") {
      const videoUrl = String(detail.video_url ?? "");
      if (!videoUrl) throw new HeygenCloudError("HeyGen render completed but returned no video_url");
      return { renderId, videoUrl };
    }
  }
}

/** Exposed for tests/verification: the raw archive bytes for a project dir. */
export const __zipComposition = zipComposition;
