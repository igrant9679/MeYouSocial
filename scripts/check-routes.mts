// Every link the app's own navigation offers must land on a page, and the map of
// who can open what (src/lib/role-links.ts) must agree with each page's own gate
// (audit E-SHL-02). role-links MIRRORS the pages: when a page changes its
// requireRole and the map doesn't, a link is shown to someone who bounces to
// /forbidden (or hidden from someone who could open it). This catches both.
//
// Checked: the rail (NAV in app/(app)/layout.tsx), every stage tab (lib/stages.ts,
// with every flag on), Help's links (lib/help.ts), Elsie's routes and links
// (lib/guide/steps.ts) and the Inbox's (lib/home.ts).
//
// Run: npm run check:routes   (exits 1 and lists the problems). Runs before every
// build (`prebuild`), so a broken link fails the deploy instead of shipping.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Role } from "@prisma/client";
import { STAGES } from "../src/lib/stages";
import { STEPS } from "../src/lib/guide/steps";
import { roleNeededFor } from "../src/lib/role-links";

const SRC = join(process.cwd(), "src");
const APP = join(SRC, "app");

// ── The route table: every page.tsx, with its gate ────────────────────────────
type Route = { pattern: RegExp; file: string; dir: string; redirectOnly: boolean };
const routes: Route[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "api") walk(p); continue; }
    if (name !== "page.tsx") continue;
    const segs = relative(APP, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
    const re = segs.map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
    const body = readFileSync(p, "utf8");
    routes.push({ pattern: new RegExp(`^/${re}$`), file: p, dir, redirectOnly: /\bredirect\(/.test(body) && !/return \(/.test(body) });
  }
}
walk(APP);

/** The strongest gate on a page: its own file, then every layout above it. */
function gateOf(route: Route): Role {
  const files = [route.file];
  for (let d = route.dir; d.startsWith(APP); d = join(d, "..")) {
    try { files.push(join(d, "layout.tsx")); readFileSync(join(d, "layout.tsx")); } catch { files.pop(); }
    if (d === APP) break;
  }
  const raw = files.map((f) => readFileSync(f, "utf8")).join("\n");
  // A page that turns a role away with a message instead of requireRole says so
  // in a `// gate: EDITOR` (or ADMIN) line — read before comments are stripped.
  const declared = raw.match(/\/\/\s*gate:\s*(ADMIN|EDITOR)\b/)?.[1] as Role | undefined;
  if (declared) return declared;
  // Comments mention requireRole("ADMIN") about OTHER pages; only code counts.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  if (/requireRole\(\s*"ADMIN"\s*\)/.test(text)) return "ADMIN";
  if (/requireRole\(\s*"EDITOR"\s*\)/.test(text)) return "EDITOR";
  return "VIEWER";
}

// ── The links ──────────────────────────────────────────────────────────────────
const links: { href: string; from: string }[] = [];
const layout = readFileSync(join(APP, "(app)", "layout.tsx"), "utf8");
const nav = layout.slice(layout.indexOf("const NAV"), layout.indexOf("];", layout.indexOf("const NAV")));
for (const m of nav.matchAll(/\{ href: "([^"]+)"/g)) links.push({ href: m[1], from: "rail" });
for (const [key, stage] of Object.entries(STAGES)) {
  links.push({ href: stage.href, from: `stage ${key}` });
  for (const t of stage.tabs({ channelId: "CHANNEL", studio: true, admin: true, operator: true })) {
    links.push({ href: t.href.replace("CHANNEL", "x"), from: `tab of ${key}` });
  }
}
for (const s of STEPS) {
  if (s.route) links.push({ href: s.route, from: `Elsie ${s.id}` });
  if (s.cta?.href) links.push({ href: s.cta.href, from: `Elsie ${s.id}` });
}
for (const [file, from] of [[join(SRC, "lib", "help.ts"), "Help"], [join(SRC, "lib", "home.ts"), "Inbox"]] as const) {
  for (const m of readFileSync(file, "utf8").matchAll(/href: "(\/[^"]*)"/g)) links.push({ href: m[1], from });
}

// ── Check ──────────────────────────────────────────────────────────────────────
const problems: string[] = [];
const seen = new Set<string>();
for (const { href, from } of links) {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/") || seen.has(`${from}|${path}`)) continue;
  seen.add(`${from}|${path}`);
  const route = routes.find((r) => r.pattern.test(path));
  if (!route) { problems.push(`${from}: ${href} is not a page`); continue; }
  if (route.redirectOnly) { problems.push(`${from}: ${href} only redirects — link to where it lands`); continue; }
  const gate = gateOf(route);
  const mapped = roleNeededFor(href);
  if (gate !== mapped) {
    problems.push(`${from}: ${href} — the page requires ${gate}, role-links says ${mapped} (${relative(process.cwd(), route.file)})`);
  }
}

const checked = new Set(links.map((l) => l.href.split(/[?#]/)[0])).size;
console.log(`${checked} distinct links from the rail, ${Object.keys(STAGES).length} stages' tabs, Help, Elsie and the Inbox · ${routes.length} pages`);
if (problems.length) {
  console.log([...new Set(problems)].map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("  ✓ every link lands on a page, and role-links agrees with every page's gate");
