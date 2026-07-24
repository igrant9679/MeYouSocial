import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { storage } from "@/lib/storage";
import type { StoryScene } from "@/lib/captions";

/**
 * Scene assembly: stitch a storyboard's rendered clips into ONE video file.
 *
 * Until now a "done" render was N separate clips the user played one by one —
 * the deliverable was never a single file. This closes that seam.
 *
 * Binary resolution is deliberately layered so no infra change is required:
 * FFMPEG_PATH env → the `ffmpeg-static` package (ships a per-platform binary,
 * so Railway needs no apt/nix package) → bare `ffmpeg` on PATH. When none
 * resolves, assembly reports "unavailable" rather than failing the render —
 * per-scene playback keeps working exactly as before.
 *
 * ffprobe is NOT used (ffmpeg-static ships no probe binary). Clips are
 * normalized one at a time, first assuming the clip carries audio and falling
 * back to a silent track when that mapping fails — which handles a board that
 * mixes Veo clips (audio) with silent ones without a probe step.
 */

const MAX_TOTAL_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

/** Pixel target per aspect. Scene clips are scaled+padded onto this canvas. */
const CANVAS: Record<string, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "16:9": { w: 1280, h: 720 },
  "1:1": { w: 1080, h: 1080 },
};

export class AssemblyUnavailable extends Error {}

// ── ffmpeg binary ────────────────────────────────────────────────────────────

// Only a SUCCESSFUL probe is cached. Caching "no binary" would make the UI's
// retry a no-op for the life of the process, which is exactly when someone is
// most likely to be fixing the deployment.
let cachedBinary: string | undefined;

async function resolveFfmpeg(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const mod = await import("ffmpeg-static");
    const p = (mod.default ?? mod) as unknown;
    if (typeof p === "string" && p) candidates.push(p);
  } catch {
    // package absent — fall through to PATH
  }
  candidates.push("ffmpeg");

  for (const candidate of candidates) {
    try {
      await run(candidate, ["-version"], 15_000);
      cachedBinary = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function run(bin: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // ffmpeg writes everything to stderr; the last lines carry the reason.
        const tail = String(stderr || err.message).trim().split("\n").slice(-4).join(" ").slice(0, 400);
        reject(new Error(tail || "ffmpeg failed"));
        return;
      }
      resolve(String(stdout || stderr));
    });
  });
}

// ── Reading clips back ───────────────────────────────────────────────────────

/**
 * Scene clips live wherever they were persisted. App-relative URLs are served
 * by session-gated routes, so they must be read through the storage layer —
 * fetching them would 401. Provider URLs (unpersisted Veo output) are fetched.
 */
async function readSource(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/uploads/")) {
      return await storage.get(decodeURIComponent(url.slice("/uploads/".length)));
    }
    if (url.startsWith("/api/files/")) {
      return await storage.get(decodeURIComponent(url.slice("/api/files/".length)));
    }
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The mock TTS stores a script, not audio — never mux that as a soundtrack. */
function looksLikeAudio(buf: Buffer): boolean {
  if (buf.byteLength < 512) return false;
  return !buf.subarray(0, 16).toString("utf8").startsWith("[MOCK TTS");
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export type AssemblyResult = {
  url: string;
  bytes: number;
  clips: number;
  withVoiceover: boolean;
};

/**
 * Normalize every clip to one codec/size/framerate, concat them, and (when a
 * real voiceover exists) replace the soundtrack with it. Returns the stored
 * file. Throws `AssemblyUnavailable` when there is no ffmpeg to run.
 */
export async function assembleScenes(
  scenes: StoryScene[],
  aspect: string,
  voiceoverUrl?: string | null,
): Promise<AssemblyResult> {
  const bin = await resolveFfmpeg();
  if (!bin) {
    throw new AssemblyUnavailable(
      "No ffmpeg binary available on this deployment — set FFMPEG_PATH or install the ffmpeg-static dependency.",
    );
  }

  const clips = scenes.filter((s) => s.outputUrl);
  if (clips.length < 2) throw new Error("Nothing to assemble — need at least two rendered scenes.");

  const canvas = CANVAS[aspect] ?? CANVAS["9:16"];
  const dir = path.join(os.tmpdir(), `mys-assemble-${nanoid(10)}`);
  await fs.mkdir(dir, { recursive: true });

  try {
    // 1. Pull each clip down and normalize it onto the shared canvas.
    const normalized: string[] = [];
    let totalIn = 0;
    for (let i = 0; i < clips.length; i++) {
      const buf = await readSource(clips[i].outputUrl!);
      if (!buf?.byteLength) throw new Error(`Scene ${i + 1}'s clip could not be read back from storage.`);
      totalIn += buf.byteLength;
      if (totalIn > MAX_TOTAL_INPUT_BYTES) throw new Error("Storyboard clips exceed the 200MB assembly limit.");

      const src = path.join(dir, `in-${i}.mp4`);
      const out = path.join(dir, `norm-${i}.mp4`);
      await fs.writeFile(src, buf);

      const vf =
        `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=decrease,` +
        `pad=${canvas.w}:${canvas.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      const videoArgs = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
      const audioArgs = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"];

      try {
        // Assume the clip carries audio (Veo 3 output does).
        await run(bin, ["-y", "-i", src, "-vf", vf, "-map", "0:v:0", "-map", "0:a:0", ...videoArgs, ...audioArgs, out]);
      } catch {
        // Silent clip: graft a null track so every segment has the same stream
        // layout — the concat demuxer requires it.
        await run(bin, [
          "-y", "-i", src,
          "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-vf", vf, "-map", "0:v:0", "-map", "1:a:0", "-shortest",
          ...videoArgs, ...audioArgs, out,
        ]);
      }
      normalized.push(out);
      await fs.rm(src, { force: true });
    }

    // 2. Concat. Every segment shares video codec + params, so the video is
    //    stream-copied (no second generation of encoding loss). Audio IS
    //    re-encoded: copying it emits non-monotonic DTS at every segment
    //    boundary (AAC priming samples), which shifts the timestamps.
    const listPath = path.join(dir, "concat.txt");
    await fs.writeFile(listPath, normalized.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
    let assembled = path.join(dir, "assembled.mp4");
    await run(bin, [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", assembled,
    ]);

    // 3. Narration replaces the clip audio when a real voiceover exists.
    //    `apad` pads the narration with silence and `-shortest` then stops at
    //    the VIDEO's end, so the cut always survives intact. Without the pad,
    //    `-shortest` truncates the video down to the narration — a 2s voiceover
    //    over a 6s board produced a 2s file.
    let withVoiceover = false;
    if (voiceoverUrl) {
      const vo = await readSource(voiceoverUrl);
      if (vo && looksLikeAudio(vo)) {
        const voPath = path.join(dir, "voiceover.bin");
        const muxed = path.join(dir, "final.mp4");
        await fs.writeFile(voPath, vo);
        try {
          await run(bin, [
            "-y", "-i", assembled, "-i", voPath,
            "-filter_complex", "[1:a]apad[a]",
            "-map", "0:v:0", "-map", "[a]", "-shortest",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", muxed,
          ]);
          assembled = muxed;
          withVoiceover = true;
        } catch {
          // Keep the concatenated video rather than losing the whole assembly
          // because the narration track wouldn't mux.
        }
      }
    }

    const bytes = (await fs.stat(assembled)).size;
    if (bytes > MAX_OUTPUT_BYTES) throw new Error("Assembled file exceeds the 200MB storage limit.");
    const stored = await storage.put("assembled.mp4", await fs.readFile(assembled), "video/mp4");
    return { url: stored.url, bytes, clips: clips.length, withVoiceover };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Whether this deployment can assemble at all (drives the UI's explanation). */
export async function assemblyAvailable(): Promise<boolean> {
  return (await resolveFfmpeg()) !== null;
}
