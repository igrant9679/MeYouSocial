// What a browser downloads (audit E-PRF-03): after every build (`postbuild`),
// fail when a client chunk carries server code or outgrows its budget.
//
// ⚠ Why: on 2026-10-28 every page that touched the composer shipped two
// ~493 KB copies of the Node crypto polyfill (PRF-03) — a server import that
// leaked into a client component — and nothing noticed. Server-only markers in
// a client chunk now fail the build, and so does a chunk past a budget well
// above today's largest (228 KB on 2026-11-01), or a total past three times
// today's (1.28 MB).
//
// Run: npm run check:bundle (after `next build`). Exits 1 and names the chunk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CHUNKS = join(process.cwd(), ".next", "static", "chunks");
const CHUNK_BUDGET = 600 * 1024;
const TOTAL_BUDGET = 4 * 1024 * 1024;
// Strings that only exist in server code: the crypto polyfill's ECDH and
// elliptic curves, the Prisma client, and the app's own secrets' names.
const SERVER_MARKERS: Array<[RegExp, string]> = [
  [/createECDH|secp256k1/, "the Node crypto polyfill (a server import in a client component)"],
  [/PrismaClient|@prisma\/client/, "the Prisma client"],
  [/TOKEN_ENCRYPTION_KEY|DATABASE_URL|AUTH_SECRET/, "a server secret's name"],
];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

let files: string[];
try {
  files = walk(CHUNKS);
} catch {
  console.error(`✗ no build output at ${relative(process.cwd(), CHUNKS)} — run next build first`);
  process.exit(1);
}
const problems: string[] = [];
let total = 0;
for (const f of files) {
  const size = statSync(f).size;
  total += size;
  const name = relative(CHUNKS, f);
  if (size > CHUNK_BUDGET) problems.push(`${name} is ${Math.round(size / 1024)} KB (budget ${CHUNK_BUDGET / 1024} KB)`);
  const body = readFileSync(f, "utf8");
  for (const [re, what] of SERVER_MARKERS) if (re.test(body)) problems.push(`${name} contains ${what}`);
}
if (total > TOTAL_BUDGET) problems.push(`client JS totals ${Math.round(total / 1024)} KB (budget ${TOTAL_BUDGET / 1024} KB)`);

if (problems.length) {
  console.error("✗ client bundle check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`  ✓ client bundle: ${files.length} chunks, ${Math.round(total / 1024)} KB, none carries server code`);
