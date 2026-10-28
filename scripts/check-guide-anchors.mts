// Checks Elsie's tour against the app as it is (audit SHL-08): every step's
// anchor must exist — a `data-elsie="…"` in the source, or `nav/<href>` for an
// entry in the rail — and every route and link must be a page that renders
// rather than one that only redirects (she waits for a URL that never comes).
// Ten steps pointed at a rail entry that had been removed.
//
// Run: npm run check:guide   (exits 1 and lists the problems when any)
//      npx tsx scripts/check-guide-anchors.mts <other-steps-file.ts>   (check another copy)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { GuideStep } from "../src/lib/guide/steps";

const { STEPS } = (await import(
  process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : "../src/lib/guide/steps"
)) as { STEPS: GuideStep[] };

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const anchors = new Set<string>();
for (const file of walk(SRC)) {
  for (const m of readFileSync(file, "utf8").matchAll(/data-elsie="([^"]+)"/g)) anchors.add(m[1]);
}
// The rail: LeftRailNav renders data-elsie={`nav${href}`} for each NAV entry.
const layout = readFileSync(join(SRC, "app", "(app)", "layout.tsx"), "utf8");
const nav = layout.slice(layout.indexOf("const NAV"), layout.indexOf("];", layout.indexOf("const NAV")));
for (const m of nav.matchAll(/\{ href: "([^"]+)"/g)) anchors.add(`nav${m[1]}`);

/** "page" | "redirect" | "missing" for an app route (static paths only). */
function pageKind(href: string): "page" | "redirect" | "missing" {
  const path = href.split(/[?#]/)[0];
  const file = join(SRC, "app", "(app)", ...path.split("/").filter(Boolean), "page.tsx");
  if (!existsSync(file)) return "missing";
  const body = readFileSync(file, "utf8");
  return /\bredirect\(/.test(body) && !/return \(/.test(body) ? "redirect" : "page";
}

const problems: string[] = [];
for (const s of STEPS) {
  if (s.anchor && !anchors.has(s.anchor)) problems.push(`${s.id}: anchor "${s.anchor}" exists nowhere`);
  for (const [what, href] of [["route", s.route], ["link", s.cta?.href]] as const) {
    if (!href) continue;
    const kind = pageKind(href);
    if (kind !== "page") problems.push(`${s.id}: ${what} ${href} is ${kind === "missing" ? "not a page" : "a redirect-only page"}`);
  }
}

console.log(`${STEPS.length} steps · ${anchors.size} anchors in the source`);
if (problems.length) {
  console.log(problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("  ✓ every anchor exists, every route and link is a real page");
