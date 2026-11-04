import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * What a video file is (E-SOC-08): its length and frame size, read once from
 * the bytes with the bundled ffmpeg when it's stored, so network rules can be
 * checked before anything is sent. Never throws: null when it can't be read
 * (the rules that need it then don't guess).
 */

export const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/** One video in a form post: the app's server-action body limit is 64 MB, so a little under it. */
export const VIDEO_BYTES = 60 * 1024 * 1024;

/** WebM/Matroska or MP4/MOV, from the first bytes — a browser can declare any type. Pure. */
export function videoKind(b: Buffer): "webm" | "mp4" | null {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp") return "mp4";
  return null;
}

export type VideoFacts = { durationSec: number; width: number | null; height: number | null };

/** Duration and size from ffmpeg's banner (`Duration: 00:02:30.04`, `1920x1080`). Pure. */
export function parseFfmpegBanner(banner: string): VideoFacts | null {
  const d = banner.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!d) return null;
  const durationSec = Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 100) / 100;
  const v = banner.match(/Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return { durationSec, width: v ? Number(v[1]) : null, height: v ? Number(v[2]) : null };
}

export async function probeVideo(bytes: Buffer): Promise<VideoFacts | null> {
  let bin: string | null = null;
  try {
    const mod = await import("ffmpeg-static");
    const p = (mod.default ?? mod) as unknown;
    bin = typeof p === "string" ? p : null;
  } catch {
    bin = null;
  }
  if (!bin) bin = process.env.FFMPEG_PATH || "ffmpeg";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mys-probe-"));
  const file = path.join(dir, "in.bin");
  try {
    await fs.writeFile(file, bytes);
    // `ffmpeg -i <file>` with no output exits non-zero but prints the facts on stderr.
    const banner = await new Promise<string>((resolve) => {
      execFile(bin!, ["-hide_banner", "-i", file], { timeout: 20_000, maxBuffer: 1024 * 1024 }, (_err, _out, stderr) => resolve(String(stderr ?? "")));
    });
    return parseFfmpegBanner(banner);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** "2:30". Pure. */
export function formatSeconds(s: number): string {
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
