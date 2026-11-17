// Model tiers only work if every AI call leaves the model BLANK unless a person
// chose one (an article's, a script's or a channel's model). A call site that
// passes the workspace's default — or a model id it names itself — looks to the
// router like a person's choice, so the job silently never gets its tier.
// (lib/llm/tiers.ts, lib/llm/index.ts `resolveUsableModel`.)
//
// Checked, in every file under src/:
//  1. each `llm.complete({…})` / `llm.stream({…})` names a `purpose`;
//  2. none of them passes the workspace's or the platform's default model, or a
//     quoted model id, as `model`;
//  3. each `resolveUsableModel(…)` outside a page obeys the same rule, and in a
//     file that makes AI calls it passes the purpose as its third argument;
//  4. every purpose has a label (lib/ai-spend.ts) and a tier (lib/llm/tiers.ts),
//     and every purpose named at a call site is one of them.
//
// Run: tsx scripts/check-model-callers.mts   (exits 1 and lists the problems).
// Runs before every build (`prebuild`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PURPOSE_TIER, UNTIERED_PURPOSES } from "../src/lib/llm/tiers";

const SRC = join(process.cwd(), "src");
const problems: string[] = [];

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(SRC);

/** Comments blanked (same length, so offsets and line numbers hold). */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

/** The text between the bracket at `open` and its match, strings skipped. */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Top-level comma-separated arguments. */
function args(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

// The workspace's or the platform's default handed over as if it were a choice.
const DEFAULT_AS_CHOICE = /\b(?:workspace|ws)\??\.defaultModel\b|\bllm\.defaultModel\b|\bDEFAULT_LLM_MODEL\b/;
const NAMED_MODEL = /^["'`](?:claude|gemini|gpt|deepseek|grok|kimi|minimax|mock)[\w.-]*["'`]/;

const labels = readFileSync(join(SRC, "lib", "ai-spend.ts"), "utf8");
const labelBlock = labels.slice(labels.indexOf("export const PURPOSE_LABEL"), labels.indexOf("};", labels.indexOf("export const PURPOSE_LABEL")));
const LABELLED = new Set([...labelBlock.matchAll(/^\s*(?:"([\w.]+)"|([\w]+)):/gm)].map((m) => m[1] ?? m[2]));

const seenPurposes = new Set<string>();
for (const file of files) {
  const rel = relative(process.cwd(), file).split(sep).join("/");
  if (rel === "src/lib/llm/index.ts") continue; // the router itself
  const src = withoutComments(readFileSync(file, "utf8"));
  const at = (i: number) => `${rel}:${src.slice(0, i).split("\n").length}`;
  const isPage = /\/page\.tsx$/.test(rel);
  let calls = 0;

  for (const m of src.matchAll(/\bllm\.(complete|stream)\(\s*\{/g)) {
    calls++;
    const body = balanced(src, m.index! + m[0].length - 1);
    const purpose = body.match(/\bpurpose\s*:\s*["'`]([\w.]+)["'`]/)?.[1];
    if (!/\bpurpose\b/.test(body)) problems.push(`${at(m.index!)}  llm.${m[1]}() names no purpose — add one from PURPOSE_LABEL (lib/ai-spend.ts)`);
    if (purpose) seenPurposes.add(purpose);
    if (purpose && !LABELLED.has(purpose)) problems.push(`${at(m.index!)}  purpose "${purpose}" has no label in PURPOSE_LABEL (lib/ai-spend.ts)`);
    const model = body.match(/\bmodel\s*:\s*([^\n]+)/)?.[1] ?? "";
    if (DEFAULT_AS_CHOICE.test(model)) problems.push(`${at(m.index!)}  llm.${m[1]}() passes the workspace or platform default as the model — pass only a person's choice, ending in ?? "" (the router inherits and applies the job's tier)`);
    if (NAMED_MODEL.test(model.trim())) problems.push(`${at(m.index!)}  llm.${m[1]}() names a model itself (${model.trim().slice(0, 30)}) — pass "" so the workspace's choice and the job's tier apply`);
  }

  for (const m of src.matchAll(/\bresolveUsableModel\(/g)) {
    if (isPage) continue; // pages only show what would run
    const list = args(balanced(src, m.index! + m[0].length - 1));
    if (DEFAULT_AS_CHOICE.test(list[0] ?? "")) problems.push(`${at(m.index!)}  resolveUsableModel() is given the workspace or platform default — pass only a person's choice, ending in ?? ""`);
    if (NAMED_MODEL.test(list[0] ?? "")) problems.push(`${at(m.index!)}  resolveUsableModel() names a model itself — pass ""`);
    if (calls > 0 || /\bllm\.(complete|stream)\(/.test(src)) {
      if (list.length < 3) problems.push(`${at(m.index!)}  resolveUsableModel() in a file that makes AI calls must pass the job's purpose as its third argument, or the result skips the job's tier`);
      const p = list[2]?.match(/^["'`]([\w.]+)["'`]$/)?.[1];
      if (p) seenPurposes.add(p);
      if (p && !LABELLED.has(p)) problems.push(`${at(m.index!)}  purpose "${p}" has no label in PURPOSE_LABEL (lib/ai-spend.ts)`);
    }
  }
}

for (const p of LABELLED) {
  if (!(p in PURPOSE_TIER) && !UNTIERED_PURPOSES.includes(p)) problems.push(`src/lib/llm/tiers.ts  purpose "${p}" has a label but no tier — add it to PURPOSE_TIER (or UNTIERED_PURPOSES if it never reaches the text router)`);
}
for (const p of [...Object.keys(PURPOSE_TIER), ...UNTIERED_PURPOSES]) {
  if (!LABELLED.has(p)) problems.push(`src/lib/llm/tiers.ts  "${p}" has a tier but no label in PURPOSE_LABEL (lib/ai-spend.ts)`);
}
for (const p of Object.keys(PURPOSE_TIER)) {
  if (!seenPurposes.has(p)) problems.push(`src/lib/llm/tiers.ts  purpose "${p}" has a tier but no call site names it — remove it, or the list in Settings promises a job that doesn't exist`);
}

if (problems.length) {
  console.error(`check-model-callers: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`check-model-callers: ${seenPurposes.size} kinds of job, each with a label and a tier; no call site passes a default as a choice.`);
