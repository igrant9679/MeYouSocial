// Checks the help copy against the app as it is (E-SHL-12): the words that
// describe the rail and the stages are BUILT from lib/nav.ts and lib/stages.ts
// (lib/stage-copy.ts), and this makes sure they stay that way —
//   · every rail entry has a hover tip, and no tip is left for an entry that's gone;
//   · the assistant's app map and its "page by page" topic carry the generated
//     stage and rail text (so nobody writes a list by hand again);
//   · the generated text names every stage tab, for every kind of viewer.
//
// Run: npx tsx scripts/check-help-copy.mts   (exits 1 and lists the problems; runs in prebuild)
import { RAIL } from "../src/lib/nav";
import { NAV_TIPS } from "../src/lib/help-tips";
import { STAGES, STAGE_HREFS } from "../src/lib/stages";
import { railSentence, stageUrls, stagesAndTabs } from "../src/lib/stage-copy";
import { APP_MAP_BRIEF, APP_GUIDE } from "../src/lib/assistant/knowledge";

const problems: string[] = [];
const railHrefs = new Set(RAIL.map((n) => n.href));
for (const n of RAIL) if (!NAV_TIPS[n.href]?.trim()) problems.push(`rail entry ${n.href} (${n.label}) has no hover tip in NAV_TIPS`);
for (const k of Object.keys(NAV_TIPS)) if (!railHrefs.has(k)) problems.push(`NAV_TIPS has a tip for ${k}, which isn't on the rail — remove it or put it back on the rail`);

const generated = stagesAndTabs();
if (!APP_MAP_BRIEF.includes(generated)) problems.push("the assistant's APP_MAP_BRIEF no longer carries stagesAndTabs() — the stage list is being written by hand again");
const map = APP_GUIDE.find((t) => t.id === "map");
if (!map) problems.push("the assistant's \"map\" guide topic is gone");
else {
  if (!map.body.includes(railSentence())) problems.push("the \"map\" topic no longer carries railSentence()");
  if (!map.body.includes(stageUrls())) problems.push("the \"map\" topic no longer carries stageUrls()");
}
for (const h of STAGE_HREFS) {
  for (const ctx of [
    { channelId: "<id>", studio: true, admin: true, operator: true },
    { channelId: null, studio: false, admin: false, operator: false },
  ]) {
    for (const t of STAGES[h].tabs(ctx)) if (!generated.includes(t.label)) problems.push(`stage ${h}: tab "${t.label}" is missing from the generated text`);
  }
}

if (problems.length) {
  console.error(`✗ help copy: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  - ${[...new Set(problems)].join("\n  - ")}`);
  process.exit(1);
}
console.log(`  ✓ help copy: ${RAIL.length} rail entries with tips, ${STAGE_HREFS.length} stages' tabs in the generated map`);
