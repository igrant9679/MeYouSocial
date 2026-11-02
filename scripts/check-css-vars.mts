// Prebuild check: every static var(--token) the source uses is defined somewhere.
//
// An undefined custom property fails silently — the declaration is dropped and
// the element just loses its colour. That is how "--red-soft" (the palette's
// name is --rose) left the Keywords error banner and the diff page's removals
// uncoloured, and how a "--card, #fff" fallback put a white arrow on a dark
// card. A token counts as defined when a CSS file declares it, a style object
// sets it ("--x": …, setProperty("--x")), or next/font names it (variable:).
// A var() with its own fallback is left alone — that's a deliberate choice.
// Dynamic names (var(--${hue}-soft)) can't be checked here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx?|mts)$/.test(name)) files.push(p);
  }
};
walk(root);

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
const defined = new Set<string>();
const sources = files.map((f) => ({ f, text: stripComments(readFileSync(f, "utf8")) }));
for (const { f, text } of sources) {
  if (f.endsWith(".css")) for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  else {
    for (const m of text.matchAll(/["'`](--[\w-]+)["'`]\s*[:\]]/g)) defined.add(m[1]);
    for (const m of text.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) defined.add(m[1]);
    for (const m of text.matchAll(/variable:\s*["'`](--[\w-]+)/g)) defined.add(m[1]);
  }
}

const missing: string[] = [];
for (const { f, text } of sources) {
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    if (m[2] === ",") continue; // has its own fallback
    if (!defined.has(m[1])) {
      const line = text.slice(0, m.index).split("\n").length;
      missing.push(`${path.relative(path.resolve(root, ".."), f)}:${line}  ${m[1]}`);
    }
  }
}

if (missing.length) {
  console.error(`✗ ${missing.length} var() reference${missing.length === 1 ? "" : "s"} to a token nothing defines:\n  ${missing.join("\n  ")}\n  (The palette's red is --rose-*; surfaces are --bg, --panel, --zebra, --card.)`);
  process.exit(1);
}
console.log(`  ✓ every var(--token) is defined (${defined.size} tokens)`);
