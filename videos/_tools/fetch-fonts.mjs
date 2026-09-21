// fetch-fonts.mjs — download the latin subsets of IBM Plex Sans / Mono from Google Fonts into _kit/assets/fonts
// and write fonts.css (relative urls). Run once; the builder inlines fonts.css into every scene.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../_kit/assets/fonts");
mkdirSync(OUT, { recursive: true });
const css = readFileSync(path.resolve(__dirname, "../_kit/assets/plex.css"), "utf8");
const blocks = css.split("@font-face").slice(1);
const out = [];
for (const b of blocks) {
  const fam = /font-family:\s*'([^']+)'/.exec(b)?.[1];
  const w = /font-weight:\s*(\d+)/.exec(b)?.[1];
  const url = /url\(([^)]+\.woff2)\)/.exec(b)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(b)?.[1] || "";
  if (!fam || !w || !url) continue;
  if (!range.includes("U+0000-00FF")) continue; // latin only
  const file = `${fam.replace(/\s+/g, "")}-${w}.woff2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed " + url);
  writeFileSync(path.join(OUT, file), Buffer.from(await res.arrayBuffer()));
  out.push(`@font-face { font-family: '${fam}'; font-style: normal; font-weight: ${w}; font-display: block; src: url('assets/brand/fonts/${file}') format('woff2'); }`);
  console.log(fam, w, "→", file);
}
writeFileSync(path.join(OUT, "fonts.css"), out.join("\n") + "\n");
console.log("wrote fonts.css with", out.length, "faces");
