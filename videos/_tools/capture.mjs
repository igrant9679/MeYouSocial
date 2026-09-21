// capture.mjs — authenticated screen capture for the Publisher videos.
//
// Uses a PERSISTENT Chromium profile (videos/_tools/.profile). The first run opens a
// headed window on the app; the owner logs in themselves; the session cookie is then
// reused by every later run (headless or headed). The script never touches credentials.
//
// Usage:
//   node capture.mjs login                       open the window, wait until /inbox is reachable
//   node capture.mjs shots <shotlist.json>       still screenshots (PNG, 1920x1080 @2x)
//   node capture.mjs clip  <scenario.json>       record a scripted interaction to MP4 (1920x1080 @1x)
//   node capture.mjs workspace "<name>"          switch the active workspace, then exit
//
// Shot list JSON: { "out": "../_captures", "workspace": "CommunityForce Inc.", "shots": [
//   { "name": "inbox", "url": "/inbox", "wait": 1200, "hide": ["text=Invitations not yet accepted"],
//     "actions": [ {"click": "text=Ideas"}, {"hover": "..."}, {"wait": 500}, {"scroll": 400} ] } ] }
//
// Scenario JSON (clip): same shape, one entry, plus "duration" cap; actions play with pauses and the
// recording is saved as <out>/<name>.mp4 (converted from webm with ffmpeg).

import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, ".profile");
const BASE = process.env.PUBLISHER_URL || "https://sparkweb-production.up.railway.app";
const VIEWPORT = { width: 1920, height: 1080 };

const [cmd, arg] = process.argv.slice(2);

async function launch({ headed = false, record = null, scale = 2 } = {}) {
  mkdirSync(PROFILE, { recursive: true });
  // The bundled Playwright Chromium is blocked from launching on this machine (spawn UNKNOWN);
  // the installed Google Chrome works. PW_CHANNEL=chromium overrides.
  const channel = process.env.PW_CHANNEL || "chrome";
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: channel === "chromium" ? undefined : channel,
    headless: !headed,
    viewport: VIEWPORT,
    deviceScaleFactor: scale,
    colorScheme: "light",
    reducedMotion: "no-preference",
    args: ["--hide-scrollbars", "--force-device-scale-factor=" + scale],
    recordVideo: record ? { dir: record, size: VIEWPORT } : undefined,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

async function isLoggedIn(page) {
  await page.goto(BASE + "/inbox", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const url = page.url();
  return !/\/(login|signin|api\/auth)/.test(url) && !(await page.locator('input[type="password"]').count());
}

async function ensureWorkspace(page, name) {
  if (!name) return;
  const sel = page.locator('select[aria-label="Switch workspace"], select:has(option:text-is("' + name + '"))').first();
  if (!(await sel.count())) return;
  const current = await sel.evaluate((el) => el.options[el.selectedIndex]?.textContent?.trim());
  if (current === name) return;
  await sel.selectOption({ label: name });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

// Elsie (the in-app guide) auto-opens a welcome card with a dimmed backdrop in a fresh profile.
// Close it if it is showing; the app snoozes it with a cookie afterwards.
// Pages stream their content after "networkidle": wait for the route skeleton to be replaced by a
// real heading before shooting (max 20 s), otherwise the capture is the shimmer shell.
async function waitReady(page) {
  await page.waitForFunction(() => {
    const main = document.querySelector("main") || document.body;
    const heading = main.querySelector("h1, h2");
    const shimmer = main.querySelector('[class*="animate-pulse"], [class*="skeleton"], [class*="shimmer"]');
    return !!heading && heading.textContent.trim().length > 0 && !shimmer;
  }, null, { timeout: 20000 }).catch(() => console.warn("  ⚠ page did not report ready in 20s"));
  await page.waitForTimeout(600);
}

async function dismissOverlays(page) {
  const close = page.locator('button[aria-label="Close the guide"]');
  if (await close.count()) {
    await close.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

// Hides mask only the matched element. Prefix "card:" to hide its enclosing card instead
// (nearest section / article / li / .card — never a bare div, which can be the whole page column).
async function applyHides(page, hides = []) {
  for (const raw of hides) {
    const card = raw.startsWith("card:");
    const sel = card ? raw.slice(5) : raw;
    await page
      .locator(sel)
      .evaluateAll((els, card) => els.forEach((el) => {
        const target = card ? (el.closest("section, article, li, .card, [class*='rounded-xl']") || el) : el;
        target.style.visibility = "hidden";
      }), card)
      .catch(() => {});
  }
}

async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.click) { await page.locator(a.click).first().click({ timeout: 8000 }).catch((e) => console.warn("click failed:", a.click, e.message)); await waitReady(page); }
    if (a.hover) await page.locator(a.hover).first().hover({ timeout: 8000 }).catch(() => {});
    if (a.type) await page.keyboard.type(a.type, { delay: a.delay ?? 45 });
    if (a.press) await page.keyboard.press(a.press);
    if (a.fill) await page.locator(a.fill.selector).first().fill(a.fill.value).catch(() => {});
    if (a.scroll) { await page.mouse.move(1000, 620); await page.mouse.wheel(0, a.scroll); }
    if (a.goto) { await page.goto(BASE + a.goto, { waitUntil: "networkidle" }).catch(() => {}); await waitReady(page); }
    if (a.mouse) await page.mouse.move(a.mouse[0], a.mouse[1], { steps: a.steps ?? 25 });
    if (a.wait) await page.waitForTimeout(a.wait);
  }
}

async function cmdLogin() {
  const { ctx, page } = await launch({ headed: true, scale: 1 });
  if (await isLoggedIn(page)) {
    console.log("Already logged in. Profile is ready.");
    await ctx.close();
    return;
  }
  console.log("Please log in to the app in the window that just opened. Waiting up to 15 minutes...");
  // Watch passively: never navigate while the person is typing. A login is detected when the
  // page leaves the auth route on its own and shows no password field.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const onAuth = /\/(login|signin|api\/auth)/.test(url) || url === "about:blank";
    const hasPassword = await page.locator('input[type="password"]').count().catch(() => 1);
    if (!onAuth && !hasPassword) {
      // one confirming check: the rail link only renders for a signed-in session
      const railOk = await page.locator('a[href="/inbox"]').count().catch(() => 0);
      if (railOk) {
        await page.waitForTimeout(1500); // let the session cookie settle
        console.log("Login detected. Profile saved to", PROFILE);
        await ctx.close();
        return;
      }
    }
  }
  console.error("Timed out waiting for login.");
  await ctx.close();
  process.exit(1);
}

async function cmdWorkspace(name) {
  const { ctx, page } = await launch({ scale: 1 });
  if (!(await isLoggedIn(page))) throw new Error("Not logged in. Run: node capture.mjs login");
  await ensureWorkspace(page, name);
  console.log("Active workspace:", name);
  await ctx.close();
}

async function cmdShots(file) {
  const list = JSON.parse(readFileSync(file, "utf8"));
  const out = path.resolve(path.dirname(file), list.out || "../_captures");
  mkdirSync(out, { recursive: true });
  const { ctx, page } = await launch({ scale: list.scale ?? 2 });
  if (!(await isLoggedIn(page))) throw new Error("Not logged in. Run: node capture.mjs login");
  await ensureWorkspace(page, list.workspace);
  for (const shot of list.shots) {
    await page.goto(BASE + shot.url, { waitUntil: "networkidle" }).catch(() => {});
    await waitReady(page);
    await page.waitForTimeout(shot.wait ?? 1200);
    await dismissOverlays(page);
    await applyHides(page, [...(list.hide || []), ...(shot.hide || [])]);
    await runActions(page, shot.actions);
    await dismissOverlays(page);
    await applyHides(page, [...(list.hide || []), ...(shot.hide || [])]);
    const target = path.join(out, shot.name + ".png");
    await page.screenshot({ path: target, fullPage: !!shot.fullPage, animations: "disabled" });
    console.log("shot", shot.name, "→", target);
  }
  await ctx.close();
}

async function cmdClip(file) {
  const sc = JSON.parse(readFileSync(file, "utf8"));
  const out = path.resolve(path.dirname(file), sc.out || "../_captures");
  mkdirSync(out, { recursive: true });
  const tmp = path.join(out, ".rec");
  mkdirSync(tmp, { recursive: true });
  const { ctx, page } = await launch({ scale: 1, record: tmp });
  if (!(await isLoggedIn(page))) throw new Error("Not logged in. Run: node capture.mjs login");
  await ensureWorkspace(page, sc.workspace);
  await page.goto(BASE + sc.url, { waitUntil: "networkidle" }).catch(() => {});
  await waitReady(page);
  await page.waitForTimeout(sc.wait ?? 1500);
  await dismissOverlays(page);
  await applyHides(page, sc.hide || []);
  const t0 = Date.now();
  await runActions(page, sc.actions);
  await page.waitForTimeout(sc.tail ?? 1500);
  const elapsed = (Date.now() - t0) / 1000;
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  const mp4 = path.join(out, sc.name + ".mp4");
  if (existsSync(mp4)) unlinkSync(mp4);
  const r = spawnSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-crf", "18", "-an", mp4], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  unlinkSync(webm);
  console.log("clip", sc.name, "→", mp4, `(${elapsed.toFixed(1)}s of actions)`);
}

try {
  if (cmd === "login") await cmdLogin();
  else if (cmd === "shots") await cmdShots(arg);
  else if (cmd === "clip") await cmdClip(arg);
  else if (cmd === "workspace") await cmdWorkspace(arg);
  else {
    console.log("usage: node capture.mjs login | shots <list.json> | clip <scenario.json> | workspace <name>");
    process.exit(2);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
