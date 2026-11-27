// Stops page copy from losing the space after a tag (2026-11-26, found verifying the workspace sign-up pages).
//
// Next's compiler (SWC) drops the leading space of a JSX text when that text contains an HTML entity
// (&apos;, &ldquo;, &nbsp;, &#39; …) and runs onto another line. So
//     <b>Auto</b> uses Google&apos;s video when a
//     key is set.
// renders "Autouses Google's video…", although the same text without the entity keeps its space and
// standard JSX keeps it too. The entity can sit on any line of the text, and the space after a closing tag,
// a self-closing tag (<Icon />) or a {…} expression is lost the same way; a trailing space is kept. Pages
// shipped "free trialfrom", "Autouses" and "zerostorage" before this check. The fix is an explicit space:
//     <b>Auto</b>{" "}uses Google&apos;s video when a
//
// This reads every .tsx in src/ with TypeScript's own parser and fails the build on that shape.
// Rule: docs/INVARIANTS.md → "A workspace signs up two ways" (the bullet on a JSX text losing its space).
// Run: npx tsx scripts/check-jsx-spaces.mts   (exits 1 and lists the problems; runs in prebuild)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ENTITY = /&(?:[a-z][a-z0-9]*|#[0-9]+|#x[0-9a-f]+);/i;

const root = process.cwd();
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".tsx")) files.push(p);
  }
})(join(root, "src"));

const problems: string[] = [];
let texts = 0;
for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  const code = readFileSync(file, "utf8");
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = n.children;
      for (let i = 1; i < kids.length; i++) {
        const t = kids[i];
        if (!ts.isJsxText(t)) continue;
        texts++;
        const raw = code.slice(t.pos, t.end);
        const firstLine = raw.split("\n")[0];
        // The lost space: text begins on the same line as the tag or {…} before it, with a space, and has
        // more than whitespace on that line; it runs onto another line; it contains an entity somewhere.
        if (!/^[ \t]+\S/.test(firstLine) || !raw.includes("\n") || !ENTITY.test(raw)) continue;
        const line = src.getLineAndCharacterOfPosition(t.pos).line + 1;
        const prev = code.slice(kids[i - 1].pos, kids[i - 1].end).split("\n").pop()!.trim().slice(-30);
        problems.push(`${rel}:${line}: the space before "${firstLine.trim().slice(0, 40)}" is dropped when built — write {" "} after ${prev}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}

if (problems.length) {
  console.error(`✗ JSX spaces: ${problems.length} problem${problems.length === 1 ? "" : "s"} (a JSX text with an entity that wraps loses its leading space)\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`  ✓ JSX spaces: no text loses its leading space, ${texts} JSX texts across ${files.length} files`);
