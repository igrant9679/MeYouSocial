// Prebuild check: the app's .tsx uses the type scale and the theme's colours (2026-11-07,
// the team tracker's "cluttered colours and fonts", growth part cz).
//
// Eighteen font sizes had grown up — 8, 9, 9.5, 10, 10.5, 11, 12, 12.5, 13, 14, 15,
// 16, 17, 18, 20, 22, 24 and 30 px — and about 250 hard-coded hex colours, most of
// them copies of a theme token that then stayed light in dark mode. The scale is
// nine steps: text-micro (10), text-2xs (11), xs (12), sm (14), base (16), lg (18),
// xl (20), 2xl (24), 3xl (30). Colours are the tokens in globals.css (--brand,
// --blue-soft, --ink …), or color-mix() of them.
//
// Refused here: a `text-[Npx]` size, and a raw #hex colour in a .tsx file — except
// the files that copy something outside the theme on purpose (below), and a line
// that says why with a `raw-colour:` comment (a preset saved as a workspace's hex,
// a colour input's default).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const ALLOWED_FILES = new Set([
  "app/icon.tsx", "app/apple-icon.tsx",            // next/og renders outside the page: no CSS variables
  "app/(app)/blog/[id]/SearchSocialPreview.tsx",   // Google's and each network's own colours, copied on purpose
  "components/BrandLogo.tsx",                      // the brand mark
]);
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".tsx")) files.push(p);
  }
};
walk(root);

const SIZE = /\btext-\[\d+(?:\.\d+)?px\]/g;
// A hex in a string, a gradient, a fallback or a Tailwind bracket — not "React #418" or "#add-expert".
const HEX = /(?<=["'(\[,]|,\s)#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?=["'),\]/\s;])/g;
const problems: string[] = [];
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, "/");
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    for (const m of line.matchAll(SIZE)) problems.push(`${rel}:${i + 1}  ${m[0]} — use the scale (text-micro, text-2xs, text-xs, text-sm, text-base, text-lg, text-xl, text-2xl)`);
    if (ALLOWED_FILES.has(rel) || /raw-colour:/.test(line) || /raw-colour:/.test(lines[i - 1] ?? "")) return;
    for (const m of line.matchAll(HEX)) problems.push(`${rel}:${i + 1}  ${m[0]} — use a theme token (var(--blue), var(--green-soft) …) or say why with a raw-colour: comment`);
  });
}

if (problems.length) {
  console.error(`check-type-colors: ${problems.length} off-scale size(s) or raw colour(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-type-colors: ${files.length} .tsx files on the type scale and the theme's colours.`);
