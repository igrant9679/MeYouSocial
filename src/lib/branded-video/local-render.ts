import { execFile } from "node:child_process";
import { existsSync, promises as fs, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

/**
 * Free local render path for branded shorts: shell out to the HyperFrames CLI,
 * which renders the composition with headless Chrome + ffmpeg on THIS machine.
 *
 * The whole point of the cloud path was to keep Chromium off Railway, so this
 * fallback is deliberately conservative: it is "available" ONLY when a real
 * Chrome is already resolvable (env var or a system install) — it never triggers
 * HyperFrames' managed Chromium download. Railway has neither, so it always
 * resolves to cloud there; a dev box or a self-hosted worker with Chrome renders
 * for free.
 */

const HF_VERSION = "0.7.71"; // pin so renders are reproducible; bump deliberately
const LOCAL_TIMEOUT_MS = 6 * 60 * 1000;

// Mirrors HyperFrames' own SYSTEM_CHROME_PATHS, plus Windows (which its list
// omits — it relies on a managed download there, which we refuse to trigger).
const SYSTEM_CHROME_PATHS =
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

// The Railway build downloads Chrome via `hyperframes browser ensure` (cached
// across builds — see nixpacks.toml [phases.build] cacheDirectories) and copies
// it into the image, writing its absolute path here (railway.json build
// command). Reading this file is the primary Railway resolution — layout- and
// version-agnostic.
const CHROME_PATH_FILE = "/app/.chrome-path";

// Fallback roots to glob if the path file is missing. /app/.chrome is where the
// build copies Chrome out of the cache mount (railway.json build command).
const CHROME_CACHE_ROOTS = [process.env.BRANDED_SHORT_CHROME_DIR, "/app/.chrome", "/app/.cache/puppeteer"].filter(Boolean) as string[];

/** Depth-limited hunt for a chrome / chrome-headless-shell executable file. */
function huntChromeBinary(dir: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const names = new Set(process.platform === "win32" ? ["chrome.exe", "chrome-headless-shell.exe"] : ["chrome", "chrome-headless-shell"]);
  for (const name of entries) {
    const full = path.join(dir, name);
    if (names.has(name) && existsSync(full)) return full;
  }
  for (const name of entries) {
    const found = huntChromeBinary(path.join(dir, name), depth - 1);
    if (found) return found;
  }
  return null;
}

function findInChromeCache(): string | null {
  try {
    const p = readFileSync(CHROME_PATH_FILE, "utf8").trim();
    if (p && existsSync(p)) return p;
  } catch {
    // no path file — try globbing
  }
  for (const root of CHROME_CACHE_ROOTS) {
    const found = huntChromeBinary(root, 6);
    if (found) return found;
  }
  return null;
}

/** An existing Chrome, or null. Env → system install → build-downloaded cache. */
function resolveChrome(): string | null {
  for (const e of [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, process.env.HYPERFRAMES_CHROME]) {
    if (e && existsSync(e)) return e;
  }
  for (const p of SYSTEM_CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return findInChromeCache();
}

/** ffmpeg-static's binary path, if the dependency is present. */
function resolveFfmpeg(): string | null {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require("ffmpeg-static") as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    // not installed — hyperframes may still find a system ffmpeg on PATH
  }
  return null;
}

/**
 * Cheap, no-spawn availability probe — safe to call on a page render. Cached for
 * the process; a machine doesn't grow a Chrome mid-run.
 */
let cached: boolean | undefined;
export function localRenderAvailable(): boolean {
  if (cached !== undefined) return cached;
  cached = resolveChrome() !== null;
  return cached;
}

export class LocalRenderError extends Error {}

/**
 * Render `projectDir` to an MP4 at a temp path and return it. Caller reads +
 * persists + cleans up (delete the returned file when done). Throws
 * LocalRenderError; the mode router catches it to fall back to cloud.
 */
export async function renderLocally(opts: {
  projectDir: string;
  variables: Record<string, unknown>;
  fps?: number;
}): Promise<{ outputPath: string; cleanup: () => Promise<void> }> {
  const chrome = resolveChrome();
  if (!chrome) throw new LocalRenderError("No local Chrome available");

  const dir = path.join(os.tmpdir(), `mys-bs-${nanoid(10)}`);
  await fs.mkdir(dir, { recursive: true });
  const varsPath = path.join(dir, "vars.json");
  const outPath = path.join(dir, "branded-short.mp4");
  await fs.writeFile(varsPath, JSON.stringify(opts.variables), "utf8");

  const ffmpeg = resolveFfmpeg();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CHROME_PATH: chrome,
    HYPERFRAMES_SKIP_SKILLS: "1",
    ...(ffmpeg ? { FFMPEG_PATH: ffmpeg } : {}),
  };

  // Run through a shell (npx is a .cmd on Windows). Pass ONE command STRING with
  // every path double-quoted — an args array + shell:true is the DEP0190 pattern
  // and would also split temp paths that contain spaces. No untrusted input is
  // in the command: title/eyebrow travel in varsPath (a file), and every path is
  // an internal nanoid temp path or the fixed template dir.
  const q = (s: string) => `"${s.replace(/"/g, '')}"`;
  const command = [
    "npx", "--yes", `hyperframes@${HF_VERSION}`, "render", q(opts.projectDir),
    "--variables-file", q(varsPath),
    "--output", q(outPath),
    "--fps", String(opts.fps ?? 30),
    "--quality", "standard",
    "--quiet",
  ].join(" ");

  await new Promise<void>((resolve, reject) => {
    execFile(command, { env, timeout: LOCAL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, shell: true }, (err, _stdout, stderr) => {
      if (err) {
        const tail = String(stderr || err.message).trim().split("\n").slice(-4).join(" ").slice(0, 400);
        reject(new LocalRenderError(tail || "local render failed"));
        return;
      }
      resolve();
    });
  });

  if (!existsSync(outPath)) throw new LocalRenderError("Local render reported success but produced no file");
  return {
    outputPath: outPath,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}
