// Stops a retired name from reaching people (2026-11-21, the owner's "The Help check").
//
// The stages, tabs and product have been renamed several times, and twice in one week the Help still
// described the old layout (11-19: the owner had to ask; 11-20: six more stale texts). Each rename's rule
// lives in docs/INVARIANTS.md, but nothing enforced it. This reads every string and JSX text in src/
// (TypeScript's own parser, so comments and code never count) and fails the build when one names a place
// that no longer exists. A mention that is ABOUT the rename ("the Drafts stage is gone") is allowed only
// through ALLOWED below, each with its reason, so an exception is a decision someone wrote down.
//
// A rename that retires a name adds a line to RETIRED in the same commit.
// Run: npx tsx scripts/check-retired-names.mts   (exits 1 and lists the problems; runs in prebuild)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

type Retired = { re: RegExp; write: string; since: string };

/** Names that no longer exist, and what to write instead. */
const RETIRED: Retired[] = [
  // A place that STARTS with the old stage; "Social posts → Drafts →" (the tab, as a link label) is fine.
  { re: /(?<!(?:→|›)\s*)\b(?:Distribute|Drafts)\s*(?:→|›|&rarr;)/g, write: "a place is \"Social posts → …\", \"Articles → …\" or \"Video → …\"", since: "2026-11-19, stages named by format" },
  { re: /\bPublish\s*(?:→|›|&rarr;)\s*(?=[A-Z])/g, write: "\"Articles → …\" (the script page's own Publish → button is not a place)", since: "2026-11-19, stages named by format" },
  { re: /\b(?:the |a )?(?:Drafts|Distribute|Publish|Review) stage\b/gi, write: "the stage's name today: Articles, Social posts, Video, or the Inbox", since: "2026-11-19 (Review: 2026-09-20)" },
  { re: /\b(?:[Oo]n|[Ii]n|[Tt]o|[Ff]rom|[Oo]pens?) Distribute\b(?! tab)/g, write: "\"Social posts\" (the article editor's Distribute tab is fine)", since: "2026-11-19, stages named by format" },
  { re: /\bReview\s*(?:→|›)\s*(?=[A-Z])/g, write: "the Inbox; reviewing happens there", since: "2026-09-20, the Review stage folded into the Inbox" },
  { re: /\bBlog (?:analytics|report|calendar)\b/gi, write: "Article analytics, Article report, Article calendar", since: "2026-11-19, the tabs say \"article\"" },
  // Case-sensitive: the tab's name, not "which post drafts are oldest".
  { re: /\bPost drafts\b/g, write: "Drafts (Social posts → Drafts)", since: "2026-11-19, Drafts is a tab name again" },
  { re: /\bBrand\s*(?:→|›)\s*Topics\b/g, write: "Ideas → Topics", since: "2026-09-21, Topics are the spine" },
  { re: /\bMeasure\s*(?:→|›)\s*Topics\b/g, write: "Measure → By Topic", since: "2026-11-17, the grouped strips" },
  { re: /\bResearch\s*(?:→|›)\s*Chat\b/g, write: "Elsie (the assistant)", since: "2026-09-09, the Research chat folded into the assistant" },
  { re: /\bPublish Admin\b/g, write: "Settings (the admin pages are Settings tabs)", since: "2026-09-20, the admin pages moved under Settings" },
  { re: /\bMeYouSocial Publish\b(?!er)/g, write: "MeYouSocial Publisher (the names live in lib/product.ts)", since: "2026-09-22, the product renamed" },
];

/** Mentions that are about a rename, not directions to an old place. `phrase` must contain the match. */
const ALLOWED: { file: string; phrase: string; why: string }[] = [
  { file: "src/app/(app)/help/guide/page.tsx", phrase: "there is no separate Review stage", why: "says the stage is gone" },
  { file: "src/lib/assistant/knowledge.ts", phrase: "there is no separate Review stage", why: "tells Elsie the stage is gone" },
  { file: "src/lib/assistant/knowledge.ts", phrase: "the Drafts stage is gone", why: "tells Elsie where an old link goes" },
  { file: "src/lib/assistant/knowledge.ts", phrase: "The Research → Chat tab was folded into me", why: "Elsie explains where the old chat went" },
  { file: "src/lib/help.ts", phrase: "The old Research → Chat tab was folded into the assistant", why: "the Help explains where the old chat went" },
  { file: "src/lib/help.ts", phrase: "Blog analytics and Blog report are", why: "the \"Where did the tabs go?\" answer maps old names to new" },
];

const root = process.cwd();
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) files.push(p);
  }
})(join(root, "src"));

/** Every piece of text a person could read: string literals, template text and JSX text. */
function textsOf(file: string): { text: string; line: number }[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return; // module paths
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      const text = ts.isJsxText(n) ? n.text.replace(/\s+/g, " ") : n.text;
      if (text.trim()) out.push({ text, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

const problems: string[] = [];
const used = new Set<number>();
let scanned = 0;
for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  for (const { text, line } of textsOf(file)) {
    scanned++;
    for (const r of RETIRED) {
      for (const m of text.matchAll(r.re)) {
        const at = m.index ?? 0;
        const ok = ALLOWED.findIndex((a) => {
          if (a.file !== rel || !a.phrase.includes(m[0].trim())) return false;
          for (let i = text.indexOf(a.phrase); i !== -1; i = text.indexOf(a.phrase, i + 1)) if (i <= at && at < i + a.phrase.length) return true;
          return false;
        });
        if (ok !== -1) { used.add(ok); continue; }
        const around = text.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, " ").trim();
        problems.push(`${rel}:${line}: "${m[0].trim()}" is retired (${r.since}); write ${r.write}\n      …${around}…`);
      }
    }
  }
}
ALLOWED.forEach((a, i) => { if (!used.has(i)) problems.push(`ALLOWED entry no longer matches anything, remove it: ${a.file} "${a.phrase}"`); });

if (problems.length) {
  console.error(`✗ retired names: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`  ✓ retired names: ${RETIRED.length} retired names, none in ${scanned} texts across ${files.length} files (${ALLOWED.length} explained mentions)`);
