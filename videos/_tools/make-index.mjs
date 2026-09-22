// make-index.mjs — build INDEX.md + index.json for the deliverables from each project's script/storyboard.
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DELIV = path.join(ROOT, "_deliverables");
const projects = readdirSync(ROOT).filter((d) => /^(d|t)\d\d-/.test(d)).sort();

const DESC = {
  "d01-the-loop": { blurb: "The whole product in one pass: the autopilot sweep, the Inbox, and the seven-stage loop from Research to Measure, with real screens of every stage.", audience: "Anyone meeting Publisher for the first time", tags: ["overview", "inbox", "loop"] },
  "d02-five-minutes": { blurb: "What tending Publisher actually looks like: the morning digest, working the Inbox top to bottom, Engage's 24-hour rule, and the assistant that proposes before it acts.", audience: "Owners and marketers without a content team", tags: ["daily routine", "inbox", "assistant"] },
  "d03-idea-to-article": { blurb: "One article end to end: an idea the engine found, the approval that lets it be drafted, the SEO and images that arrive filled in, the checklist of gates, and publishing with or without WordPress.", audience: "Marketers evaluating an AI content pipeline", tags: ["ideas", "drafts", "gates", "publish"] },
  "d04-gates": { blurb: "How Publisher earns trust: seven required checks before anything goes live, claims sourced by live search and an independent judge, every AI image inspected, and never an invented number.", audience: "Teams that need to trust AI-generated content", tags: ["trust", "claims", "images", "measure"] },
  "d05-distribute": { blurb: "Social on a schedule you set once: fifteen networks through one connection, per-network overrides, wall-clock posting slots, the calendar, campaigns, evergreen recycling and server-enforced approval.", audience: "Marketers running a daily social presence", tags: ["social", "slots", "calendar", "approval"] },
  "d06-control-measure": { blurb: "Governance and results: four function modes, the full-autonomy switch that remembers your dials, global pause, roles and sealed workspaces, the audit log, and measured numbers only.", audience: "Teams and agencies that need control", tags: ["automation", "roles", "workspaces", "measure"] },
  "t01-orientation": { blurb: "First-day orientation: the mental model, the left rail top to bottom, the Inbox, the stage strip and its badges, Elsie's tours, the Help Center, and Ask.", audience: "New users", tags: ["getting started", "navigation", "help"] },
  "t02-setup": { blurb: "Setting a workspace up in order: AI keys and the default model, live search, images and vision, Connections, Analytics, the clock, the gates, the dials, and inviting the team.", audience: "Admins", tags: ["setup", "keys", "connections", "analytics"] },
  "t03-brand-topics": { blurb: "Teaching it your voice: the seven Motifs, the brand kit and asset policy, brand context that is never AI-written, Experts, and Topics as the one tag that spans every surface.", audience: "Admins and marketers", tags: ["brand", "motifs", "topics", "experts"] },
  "t04-research-ideas": { blurb: "Intel and the outlier score, channels and competitors, Make it an idea, the Ideas board and its lanes, the weekly triage, and the keyword strategy behind priorities.", audience: "Editors running the weekly triage", tags: ["research", "intel", "ideas", "keywords"] },
  "t05-drafts-optimize": { blurb: "Reading a draft: the board's stages, the editor's five tabs, SEO and images, the Gates sidebar, and Optimize's mechanical, knowledge and strategic findings.", audience: "Editors", tags: ["drafts", "editor", "seo", "optimize"] },
  "t06-review": { blurb: "Clearing every kind of hold from the Inbox: questions, unsourced claims, held images, held articles and Advance anyway, Approvals and Audit, and why every clearing act moves the article at once.", audience: "Editors and admins", tags: ["review", "inbox", "claims", "gates"] },
  "t07-publish": { blurb: "Publishing: the Publish page, publish day versus a set date versus now, WordPress, the Download HTML and Mark as published path, and why an article might never publish.", audience: "Admins who publish", tags: ["publish", "wordpress", "html export"] },
  "t08-compose-schedule": { blurb: "Composing and scheduling social: the composer and per-network overrides, Queue, Schedule and Post now, slots and timezone, the calendar, campaigns and evergreen.", audience: "Marketers running the social calendar", tags: ["social", "compose", "slots", "calendar"] },
  "t09-approvals-engage": { blurb: "The approval workflow enforced on the server, the Approvals tab, queue on approval, Engage and the 24-hour DM window, and account health and failed sends.", audience: "Admins and community managers", tags: ["approval", "engage", "social"] },
  "t10-automation": { blurb: "The autonomy dials: manual, assisted and auto per function, targets and cadence, full autonomy, global pause and Run cycle now, the social idea gate, and why nothing is being drafted.", audience: "Admins", tags: ["automation", "autonomy", "dials"] },
  "t11-measure": { blurb: "Measuring results: connecting Search Console and GA4, Search and Traffic, Social performance and best time to post, the ten stock Reports, Insights, and why a dash is never a zero.", audience: "Admins and marketers", tags: ["measure", "analytics", "reports", "insights"] },
  "t12-assistant-team": { blurb: "Working with the assistant and running the workspace: Ask and proposals, roles and People, workspaces and branding, the digest and the audit log, and the seven things to check when something looks wrong.", audience: "Everyone; admins for the team section", tags: ["assistant", "team", "roles", "troubleshooting"] },
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const rows = [];
for (const p of projects) {
  const script = JSON.parse(readFileSync(path.join(ROOT, p, "script.json"), "utf8"));
  const file = `${p}.mp4`;
  const full = path.join(DELIV, file);
  if (!existsSync(full)) continue;
  const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${full}"`).toString().trim());
  const size = statSync(full).size;
  const chapters = script.scenes.filter((s) => s.chapter).map((s) => s.chapter.replace(/^\d\d · /, ""));
  const sb = readFileSync(path.join(ROOT, p, "STORYBOARD.md"), "utf8");
  const starts = [...sb.matchAll(/## Frame \d+ — (s\d\d)\n[\s\S]*?start: ([0-9.]+)/g)].map((m) => [m[1], Number(m[2])]);
  const chapterMarks = script.scenes.filter((s) => s.chapter).map((s) => ({ time: fmt(starts.find(([id]) => id === s.id)?.[1] ?? 0), title: s.chapter.replace(/^\d\d · /, "") }));
  const clips = existsSync(path.join(ROOT, p, "assets/clips")) ? readdirSync(path.join(ROOT, p, "assets/clips")).length : 0;
  const stills = existsSync(path.join(ROOT, p, "assets/stills")) ? readdirSync(path.join(ROOT, p, "assets/stills")).length : 0;
  const d = DESC[p] || {};
  rows.push({
    id: p, set: script.kind === "demo" ? "Demo" : "Training", number: p.slice(0, 3).toUpperCase().replace(/^([DT])0?/, "$1"),
    title: script.title, file, durationSeconds: Math.round(dur * 10) / 10, duration: fmt(dur), sizeMB: Math.round(size / 1048576 * 10) / 10,
    resolution: "1920×1080", fps: 30, codec: "H.264 / AAC", narrator: "Michael (Kokoro TTS, male)", captions: !!script.captions,
    message: script.message || "", audience: d.audience || script.audience || "", description: d.blurb || "", tags: d.tags || [],
    chapters: chapterMarks, footage: { recordedClips: clips, screenshots: stills },
  });
}

const demos = rows.filter((r) => r.set === "Demo"), training = rows.filter((r) => r.set === "Training");
const total = rows.reduce((n, r) => n + r.durationSeconds, 0);
let md = `# MeYouSocial Publisher — video library\n\n`;
md += `Eighteen videos: six demos and twelve training walkthroughs. All are 1920×1080, 30 fps, H.264 MP4 with AAC narration. Narration is a male voice (Michael). Training videos carry verbatim captions burned in. Every video shows the real product: screenshots plus recorded clips of the app in use. Total running time ${fmt(total)}.\n\n`;
md += `> The product is called **MeYouSocial Publisher** in every video. Screens were captured before the in-app rename, so the app chrome still reads "Publish".\n\n`;
for (const [heading, list, note] of [["Demo videos", demos, "Value-first overviews, about two minutes each. Suggested order below."], ["Training videos", training, "Task walkthroughs, two and a half to three and a half minutes each, with captions. Designed to be watched in order; each one hands off to the next."]]) {
  md += `## ${heading}\n\n${note}\n\n`;
  md += `| # | Title | File | Length | Size | Captions |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const r of list) md += `| ${r.number} | ${r.title} | \`${r.file}\` | ${r.duration} | ${r.sizeMB} MB | ${r.captions ? "Yes" : "No"} |\n`;
  md += `\n`;
  for (const r of list) {
    md += `### ${r.number} · ${r.title}\n\n`;
    md += `**File:** \`${r.file}\` · **Length:** ${r.duration} · **Size:** ${r.sizeMB} MB · **Footage:** ${r.footage.recordedClips} recorded clip${r.footage.recordedClips === 1 ? "" : "s"}, ${r.footage.screenshots} screenshots\n\n`;
    md += `${r.description}\n\n`;
    md += `**One-line message:** ${r.message}\n\n**Audience:** ${r.audience}\n\n**Chapters:** ${r.chapters.map((c) => `${c.time} ${c.title}`).join(" · ")}\n\n**Tags:** ${r.tags.join(", ")}\n\n`;
  }
}
md += `## Publishing notes\n\n- Suggested page order: the six demos first (D1 is the entry point), then the training series in number order.\n- Each video opens on a branded title card and closes on the MeYouSocial Publisher lockup, so they stand alone or play as a list.\n- Poster frames: any frame between 0:03 and 0:08 of each file shows the title card.\n- The \`chapters\` list in \`index.json\` matches YouTube's chapter format (\`m:ss Title\`) if you paste it into a description.\n- Files are named by set and number (\`d01…d06\`, \`t01…t12\`) so they sort correctly.\n- Every MP4 is remuxed with \`faststart\` (the index atom leads the file), so playback begins before the download finishes.\n- Host the MP4s on a server or CDN that answers HTTP byte-range requests (status 206). Every normal web host and CDN does; without it, seeking and the chapter links in the gallery fall back to the start of the file.\n- \`index.html\` is a self-contained gallery page: drop it in the same folder as the MP4s and \`posters/\`. It needs no build step and no server-side code; only the two Google Fonts stylesheets are loaded externally.\n`;
writeFileSync(path.join(DELIV, "INDEX.md"), md);
writeFileSync(path.join(DELIV, "index.json"), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), product: "MeYouSocial Publisher", totalDuration: fmt(total), videos: rows }, null, 2));
console.log(`${rows.length} videos · total ${fmt(total)} · INDEX.md + index.json written to _deliverables`);
