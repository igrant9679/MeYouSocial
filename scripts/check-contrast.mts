// Text people can read, in light and dark (2026-11-22, the owner's "Yes, build it" to a contrast check).
//
// Works the theme out of src/app/globals.css: light = the `:root` tokens; dark = those plus
// `html[data-theme="dark"]`, resolving var() and color-mix(in srgb …). Then it fails the build when text
// falls under WCAG AA, 4.5:1, in EITHER theme:
//   1. TOKENS: --ink, --slate and --mute on every surface (--bg, --card, --panel, --zebra); each hue's
//      --x-on on its own --x-soft and on every surface; white on --accent-strong (primary buttons).
//   2. ELEMENTS: every JSX element in src/**/*.tsx whose className and/or style give it BOTH a text and a
//      background colour, state by state (a hover background is paired with the hover text, or the
//      resting text when there is no hover text).
//   3. CSS RULES in globals.css that set both (a `html[data-theme="dark"]` rule counts in dark only).
//   4. No text in a BARE hue in .tsx (`text-[var(--amber)]`, `color: "var(--amber)"`): text and icons use
//      --x-on, which the dark theme lifts. A bare hue is for backgrounds, borders and dots.
//   5. The `[data-theme="auto"]` copy of the dark theme (prefers-color-scheme) says exactly what
//      `[data-theme="dark"]` says, tokens and rules alike.
// A pair it can't resolve (a gradient, a value built at run time) is skipped and counted, never guessed.
// An exception goes in ALLOWED with its reason; an entry that stops matching fails too.
//
// Run: npx tsx scripts/check-contrast.mts   (exits 1 and lists the problems; runs in prebuild)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const MIN = 4.5;
const root = process.cwd();
const CSS_PATH = join(root, "src", "app", "globals.css");
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Element pairs that may stay under 4.5:1, with the reason. `file` + a substring of the element's source. */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  {
    file: "src/app/(app)/production/projects/[id]/page.tsx",
    contains: `background: "var(--green)", borderColor: "var(--green)", color: "white"`,
    why: "a ticked checklist box: its only content is a white check-mark ICON, and WCAG asks 3:1 of non-text marks — it is 4.00:1 in both themes",
  },
];

// ── The theme ────────────────────────────────────────────────────────────────────────────────────────
type Tokens = Record<string, string>;
function declarations(body: string): Tokens {
  const out: Tokens = {};
  for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
function blocks(selector: RegExp): string[] {
  return [...css.matchAll(new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`, "g"))].map((m) => m[1]);
}
const light: Tokens = Object.assign({}, ...blocks(/(?:^|\n)\s*:root/).map(declarations));
const darkOwn: Tokens = Object.assign({}, ...blocks(/html\[data-theme="dark"\]/).map(declarations));
const autoOwn: Tokens = Object.assign({}, ...blocks(/html\[data-theme="auto"\]/).map(declarations));
const THEMES = { light, dark: { ...light, ...darkOwn } } as const;
type ThemeName = keyof typeof THEMES;

type RGB = [number, number, number];
function color(value: string, theme: Tokens, depth = 0): RGB | null {
  if (depth > 25) return null;
  const v = value.replace(/!important/, "").trim();
  if (v === "white" || v === "#fff" || v === "#FFF") return [255, 255, 255];
  if (v === "black" || v === "#000") return [0, 0, 0];
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as RGB;
  // var(--x) or var(--x, fallback) — the fallback may hold its own var(…), so it is taken greedily.
  m = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (m) {
    if (theme[m[1]] !== undefined) return color(theme[m[1]], theme, depth + 1);
    return m[2] ? color(m[2], theme, depth + 1) : null;
  }
  m = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+)\)$/);
  if (m) {
    const a = color(m[1], theme, depth + 1), b = color(m[3], theme, depth + 1);
    if (!a || !b) return null;
    const p = Number(m[2]) / 100;
    return a.map((x, i) => x * p + b[i] * (1 - p)) as RGB;
  }
  return null;
}
const luminance = ([r, g, b]: RGB) => {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const problems: string[] = [];
let pairsChecked = 0, skipped = 0;
const skippedList: string[] = []; // CONTRAST_VERBOSE=1 prints them
/**
 * A background's colours: one, or every colour stop of a linear/radial gradient (text over a gradient
 * has to read over its worst stop). null when any part can't be resolved (an image, rgba over a picture).
 */
function backgroundColors(value: string, theme: Tokens): RGB[] | null {
  const g = value.trim().match(/^(?:linear|radial)-gradient\((.*)\)$/);
  if (!g) { const c = color(value, theme); return c ? [c] : null; }
  const stops = [...g[1].matchAll(/var\(--[a-z0-9-]+(?:\s*,[^()]*(?:\([^()]*\))?[^()]*)?\)|#[0-9a-fA-F]{3,6}\b|\bwhite\b|\bblack\b|\brgba?\([^)]*\)|\btransparent\b/g)].map((x) => x[0]);
  if (!stops.length) return null;
  const out: RGB[] = [];
  for (const s of stops) { const c = color(s, theme); if (!c) return null; out.push(c); }
  return out;
}

/** Check one pair in the given themes; returns false if it failed somewhere. */
function pair(where: string, fg: string, bg: string, themes: ThemeName[] = ["light", "dark"]): boolean {
  let ok = true;
  for (const t of themes) {
    const f = color(fg, THEMES[t]), bs = backgroundColors(bg, THEMES[t]);
    if (!f || !bs) { skipped++; skippedList.push(`${where} [${t}]: ${fg} on ${bg}`); continue; }
    pairsChecked++;
    const r = Math.min(...bs.map((b) => ratio(f, b)));
    if (r < MIN) { ok = false; problems.push(`${where}: ${fg} on ${bg} is ${r.toFixed(2)}:1 in ${t} (needs ${MIN})`); }
  }
  return ok;
}

// ── 1. Tokens ────────────────────────────────────────────────────────────────────────────────────────
const SURFACES = ["--bg", "--card", "--panel", "--zebra"];
const HUES = Object.keys(light).filter((k) => /^--[a-z0-9]+-soft$/.test(k)).map((k) => k.slice(2, -5)).filter((h) => light[`--${h}-on`] !== undefined);
for (const t of ["--ink", "--slate", "--mute"]) for (const s of SURFACES) pair("token", `var(${t})`, `var(${s})`);
for (const h of HUES) {
  pair("token", `var(--${h}-on)`, `var(--${h}-soft)`);
  for (const s of SURFACES) pair("token", `var(--${h}-on)`, `var(${s})`);
}
pair("token", "white", "var(--accent-strong)");

// ── 5. The auto copy of the dark theme says the same ────────────────────────────────────────────────
for (const k of new Set([...Object.keys(darkOwn), ...Object.keys(autoOwn)])) {
  if (darkOwn[k] !== autoOwn[k]) problems.push(`globals.css: ${k} is "${darkOwn[k] ?? "(unset)"}" for data-theme="dark" but "${autoOwn[k] ?? "(unset)"}" for "auto" — keep the two dark copies identical`);
}
const ruleBodies = (prefix: string) =>
  new Map([...css.matchAll(new RegExp(`html\\[data-theme="${prefix}"\\]\\s+([^{}]+?)\\s*\\{([^{}]*)\\}`, "g"))].map((m) => [m[1].replace(/\s+/g, " ").replace(new RegExp(`html\\[data-theme="${prefix}"\\]\\s*`, "g"), ""), m[2].replace(/\s+/g, " ").trim()]));
const darkRules = ruleBodies("dark"), autoRules = ruleBodies("auto");
for (const sel of new Set([...darkRules.keys(), ...autoRules.keys()])) {
  if (darkRules.get(sel) !== autoRules.get(sel)) problems.push(`globals.css: the rule "${sel}" differs between data-theme="dark" and the "auto" copy — keep them identical`);
}

// ── 3. CSS rules that set both ──────────────────────────────────────────────────────────────────────
const cssDarkSelectors = new Set(darkRules.keys());
for (const m of css.matchAll(/([^{}@;]+?)\s*\{([^{}]*)\}/g)) {
  const selector = m[1].replace(/\s+/g, " ").trim();
  if (/data-theme="auto"/.test(selector) || /^:root$|^@/.test(selector)) continue;
  const fg = m[2].match(/(?:^|[;\s])color\s*:\s*([^;]+)/)?.[1];
  const bg = m[2].match(/background(?:-color)?\s*:\s*([^;]+)/)?.[1];
  if (!fg || !bg) continue;
  const dark = /data-theme="dark"/.test(selector);
  const base = selector.replace(/html\[data-theme="dark"\]\s*/g, "");
  const themes: ThemeName[] = dark ? ["dark"] : cssDarkSelectors.has(base) ? ["light"] : ["light", "dark"];
  pair(`globals.css "${selector}"`, fg.trim(), bg.trim(), themes);
}

// ── 2 and 4. Elements in .tsx ───────────────────────────────────────────────────────────────────────
const HUE_TEXT_CLASS = new RegExp(`(?:^|[\\s:"'\`])text-\\[var\\(--(${HUES.join("|")})\\)\\]`, "g");
const files: string[] = [];
(function walk(dir: string) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".tsx")) files.push(p);
  }
})(join(root, "src"));

const THEME_CLASS = new Set(["ink", "slate", "mute", "line", "line-2", "panel", "zebra", "brand", "brand-2", "brand-soft", "accent", "accent-soft", "accent-strong"]);
function classColor(util: string, kind: "text" | "bg"): string | null {
  if (!util.startsWith(`${kind}-`)) return null;
  const rest = util.slice(kind.length + 1);
  const v = rest.match(/^\[var\((--[a-z0-9-]+)\)\]$/);
  if (v) return `var(${v[1]})`;
  if (rest === "white" || rest === "black") return rest;
  if (THEME_CLASS.has(rest)) return `var(--${rest})`;
  return null;
}
/** variant ("" = resting, "hover:", "focus:" …) → colour, for text and for background. */
function fromClasses(text: string) {
  const fg = new Map<string, string>(), bg = new Map<string, string>();
  for (const tok of text.split(/\s+/)) {
    if (!tok) continue;
    const cut = tok.lastIndexOf(":", tok.indexOf("[") === -1 ? tok.length : tok.indexOf("["));
    const variant = cut === -1 ? "" : tok.slice(0, cut + 1), util = cut === -1 ? tok : tok.slice(cut + 1);
    const f = classColor(util, "text"), b = classColor(util, "bg");
    if (f) fg.set(variant, f);
    if (b) bg.set(variant, b);
  }
  return { fg, bg };
}
/**
 * The class strings an expression can produce, branch by branch: `a ? "x" : "y"` is two strings, not
 * "x y" — joining them would pair one branch's text with the other's background. `cond && "x"` is
 * "x" or nothing. Anything else contributes its string literals to every alternative. Capped, so a
 * long chain of conditions can't explode.
 */
const MAX_ALTS = 32;
function classAlternatives(n: ts.Node): string[] {
  const cross = (a: string[], b: string[]) => a.flatMap((x) => b.map((y) => `${x} ${y}`)).slice(0, MAX_ALTS);
  if (ts.isJsxExpression(n)) return n.expression ? classAlternatives(n.expression) : [""];
  if (ts.isParenthesizedExpression(n)) return classAlternatives(n.expression);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (ts.isConditionalExpression(n)) return [...classAlternatives(n.whenTrue), ...classAlternatives(n.whenFalse)].slice(0, MAX_ALTS);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return ["", ...classAlternatives(n.right)].slice(0, MAX_ALTS);
  if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    return [...classAlternatives(n.left), ...classAlternatives(n.right)].slice(0, MAX_ALTS);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return cross(classAlternatives(n.left), classAlternatives(n.right));
  if (ts.isTemplateExpression(n)) {
    let alts = [n.head.text];
    for (const s of n.templateSpans) alts = cross(cross(alts, classAlternatives(s.expression)), [s.literal.text]);
    return alts;
  }
  if (ts.isCallExpression(n)) return n.arguments.reduce<string[]>((acc, a) => cross(acc, classAlternatives(a)), [""]);
  if (ts.isArrayLiteralExpression(n)) return n.elements.reduce<string[]>((acc, a) => cross(acc, classAlternatives(a)), [""]);
  return [""]; // an identifier or a call result we can't see into contributes nothing
}
const styleValue = (o: ts.ObjectLiteralExpression, names: string[]): string | undefined => {
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && names.includes(p.name.text)) {
      if (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) return p.initializer.text;
    }
  }
  return undefined;
};

const allowedUsed = new Set<number>();
let elements = 0;
for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  const text = readFileSync(file, "utf8");
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let classAlts: string[] = [""];
      const styles: ts.ObjectLiteralExpression[] = [];
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText(src);
        if (name === "className") classAlts = classAlternatives(a.initializer);
        if (name === "style") {
          const collect = (x: ts.Node) => { if (ts.isObjectLiteralExpression(x)) styles.push(x); else ts.forEachChild(x, collect); };
          collect(a.initializer);
        }
      }
      const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
      const where = `${rel}:${line}`;
      const source = node.getText(src);
      // 4. a bare hue as text
      for (const m of new Set(classAlts.flatMap((c) => [...c.matchAll(HUE_TEXT_CLASS)].map((x) => x[1]))))
        problems.push(`${where}: text-[var(--${m})] — text in a hue uses var(--${m}-on), which dark mode lifts`);
      for (const s of styles) {
        const c = styleValue(s, ["color"]);
        const hue = c?.match(/^var\(--([a-z0-9]+)\)$/)?.[1];
        if (hue && HUES.includes(hue)) problems.push(`${where}: color "var(--${hue})" — text in a hue uses var(--${hue}-on), which dark mode lifts`);
      }
      // 2. text and background on one element, branch by branch and state by state
      const candidates: { label: string; f?: string; b?: string }[] = [];
      for (const classes of classAlts) {
        const { fg, bg } = fromClasses(classes);
        for (const v of new Set([...fg.keys(), ...bg.keys()])) candidates.push({ label: v || "resting", f: fg.get(v) ?? fg.get(""), b: bg.get(v) ?? bg.get("") });
        for (const s of styles) {
          const sf = styleValue(s, ["color"]), sb = styleValue(s, ["background", "backgroundColor"]);
          if (sf || sb) candidates.push({ label: "style", f: sf ?? fg.get(""), b: sb ?? bg.get("") });
        }
      }
      for (const c of candidates) {
        if (!c.f || !c.b) continue;
        elements++;
        const before = problems.length;
        if (!pair(`${where} (${c.label})`, c.f, c.b)) {
          const i = ALLOWED.findIndex((a) => a.file === rel && source.includes(a.contains));
          if (i !== -1) { allowedUsed.add(i); problems.length = before; }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
ALLOWED.forEach((a, i) => { if (!allowedUsed.has(i)) problems.push(`ALLOWED entry no longer needed, remove it: ${a.file} "${a.contains}"`); });

if (problems.length) {
  console.error(`✗ contrast: ${problems.length} problem${problems.length === 1 ? "" : "s"} (WCAG AA is ${MIN}:1)\n  - ${[...new Set(problems)].join("\n  - ")}`);
  process.exit(1);
}
if (process.env.CONTRAST_VERBOSE) console.log(`skipped (unresolvable):\n  ${skippedList.join("\n  ")}`);
console.log(`  ✓ contrast: ${pairsChecked} pairs at ${MIN}:1 or better in light and dark (${HUES.length} hues, ${elements} element pairs in ${files.length} files${skipped ? `, ${skipped} unresolvable skipped` : ""})`);
