// build.mjs — script.json → narration (Kokoro) → scene compositions → index.html → ledger → stamped seams.
//
// Usage:  node build.mjs <video-dir>            (video-dir contains script.json)
//         node build.mjs <video-dir> --no-tts   (reuse existing narration, only rebuild HTML)
//
// script.json shape — see videos/_kit/README.md. Timing follows the house rule:
//   scene duration = voice + 0.5 lead + 1.4 tail (1.8 on the close); voice starts 0.5 s into its scene;
//   scenes sit edge to edge; root duration is the sum.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(__dirname, "../_kit");
const CAPTURES = path.resolve(__dirname, "../_captures");
const SEAM_STAMP = path.join(process.env.USERPROFILE || process.env.HOME, ".claude/skills/motion-doctrine/scripts/seam-stamp.mjs");
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

const dir = path.resolve(process.argv[2] || ".");
const NO_TTS = process.argv.includes("--no-tts");
const script = JSON.parse(readFileSync(path.join(dir, "script.json"), "utf8"));
const VOICE = script.voice || "am_michael";
const FPS = 30;

// ---------- brand tokens (from _kit/frame.md) ----------
const B = {
  canvas: "#FBF7F5", deep: "#15181D", ink: "#15181D", ink2: "#4A4F58",
  coral: "#E5482F", coralDeep: "#B5371F", coralSoft: "#FDE7E1", line: "rgba(21,24,29,.18)", white: "#FFFFFF",
  sans: "'IBM Plex Sans', 'IBM Plex Mono', system-ui, sans-serif", mono: "'IBM Plex Mono', monospace",
};

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
// "Your job is *decisions.*" → spans; *word* = accent
function words(text, cls = "w") {
  // *two words* → *two* *words* so multi-word accents work
  text = String(text).replace(/\*([^*]+)\*/g, (m, inner) => inner.trim().split(/\s+/).map((w) => "*" + w + "*").join(" "));
  return String(text).split(/\s+/).filter(Boolean).map((w) => {
    const acc = /^\*.+\*[.,!?]*$/.test(w);
    const clean = w.replace(/\*/g, "");
    return `<span class="${cls}${acc ? " accent" : ""}" data-layout-allow-overlap>${esc(clean)}</span>`;
  }).join(" ");
}
const wordCount = (t) => String(t).split(/\s+/).filter(Boolean).length;
// beat time inside a scene: number = seconds; "w:12" = at spoken word 12 (proportional to real voice length)
const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, "");
function beat(at, scene) {
  if (typeof at === "number") return at;
  if (typeof at === "string" && at.startsWith("w:")) {
    const i = Number(at.slice(2));
    if (scene.words && scene.words[i]) return r3(0.5 + scene.words[i].s);
    const n = Math.max(1, wordCount(scene.narration));
    return r3(0.5 + (i / n) * scene.voice);
  }
  if (typeof at === "string" && at.startsWith("q:")) { // quote a phrase → where it is spoken
    const phrase = at.slice(2).split(/\s+/).map(norm).filter(Boolean);
    // real word timings (Whisper) when present: match the phrase's first two words in sequence
    if (scene.words && scene.words.length) {
      const ws = scene.words;
      for (let i = 0; i < ws.length; i++) {
        if (norm(ws[i].w) === phrase[0] && (phrase.length < 2 || (ws[i + 1] && norm(ws[i + 1].w) === phrase[1]))) return r3(0.5 + ws[i].s);
      }
      const j = ws.findIndex((x) => norm(x.w) === phrase[0]);
      if (j >= 0) return r3(0.5 + ws[j].s);
    }
    const ws = String(scene.narration).replace(/[*]/g, "").split(/\s+/).map(norm);
    let i = -1;
    for (let k = 0; k < ws.length; k++) if (ws[k] === phrase[0] && (phrase.length < 2 || ws[k + 1] === phrase[1])) { i = k; break; }
    if (i < 0) i = ws.findIndex((w) => w === phrase[0]);
    return beat("w:" + (i < 0 ? 0 : i), scene);
  }
  return 0.5;
}

// ---------- 1. narration ----------
const voDir = path.join(dir, "assets/vo");
mkdirSync(voDir, { recursive: true });
const manifestPath = path.join(voDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
function ffprobeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(String(r.stdout).trim());
}
for (const sc of script.scenes) {
  const wav = path.join(voDir, sc.id + ".wav");
  const spoken = (sc.spoken || sc.narration).replace(/\*/g, "");
  const hash = createHash("sha1").update(VOICE + "|" + spoken).digest("hex").slice(0, 12);
  if (!NO_TTS && (!existsSync(wav) || manifest[sc.id]?.hash !== hash)) {
    process.stdout.write(`tts ${sc.id} … `);
    // text goes through a file: with shell:true a quoted sentence is split at spaces on Windows
    const txt = path.join(voDir, sc.id + ".txt");
    writeFileSync(txt, spoken, "utf8");
    const r = spawnSync(NPX, ["-y", "hyperframes@latest", "tts", "--voice", VOICE, "--speed", String(script.speed || 1), "-o", wav, "--json", "--text-file", txt], { encoding: "utf8", shell: true, cwd: dir });
    const line = String(r.stdout).split("\n").find((l) => l.trim().startsWith("{"));
    if (!line) { console.error(r.stdout, r.stderr); throw new Error("tts failed for " + sc.id); }
    const j = JSON.parse(line);
    manifest[sc.id] = { hash, duration: j.durationSeconds, text: spoken };
    console.log(j.durationSeconds + "s");
  }
  sc.voice = manifest[sc.id]?.duration ?? ffprobeDuration(wav);
  if (!sc.voice) throw new Error("no voice duration for " + sc.id);
  // word timings (local Whisper) — for captions and for landing callouts on the spoken word
  const wordsFile = path.join(voDir, sc.id + ".words.json");
  if (script.captions || script.wordTimings) {
    if (!existsSync(wordsFile) || manifest[sc.id]?.wordsHash !== hash) {
      process.stdout.write(`words ${sc.id} … `);
      const r = spawnSync("python", [path.join(__dirname, "words.py"), wav, wordsFile], { encoding: "utf8" });
      if (r.status !== 0) console.warn("\n  ⚠ whisper failed for " + sc.id + ": " + String(r.stderr).slice(-300));
      else { manifest[sc.id].wordsHash = hash; console.log(String(r.stdout).trim().split("\n").pop()); }
    }
    if (existsSync(wordsFile)) sc.words = JSON.parse(readFileSync(wordsFile, "utf8")).words;
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// ---------- 2. timing ----------
let t = 0;
script.scenes.forEach((sc, i) => {
  const last = i === script.scenes.length - 1;
  sc.tail = sc.tail ?? (last || sc.type === "close" ? 1.8 : 1.4);
  sc.lead = 0.5;
  sc.duration = r1(sc.voice + sc.lead + sc.tail);
  sc.start = r1(t);
  t = r1(t + sc.duration);
});
const TOTAL = r1(t);

// ---------- 3. assets ----------
const stillsDir = path.join(dir, "assets/stills");
const clipsDir = path.join(dir, "assets/clips");
const brandDir = path.join(dir, "assets/brand");
[stillsDir, clipsDir, brandDir, path.join(dir, "compositions")].forEach((d) => mkdirSync(d, { recursive: true }));
cpSync(path.join(KIT, "assets"), brandDir, { recursive: true });
const FONT_FACES = existsSync(path.join(KIT, "assets/fonts/fonts.css")) ? readFileSync(path.join(KIT, "assets/fonts/fonts.css"), "utf8") : "";
function stage(name, kind) {
  if (!name) return null;
  const src = existsSync(path.join(CAPTURES, name)) ? path.join(CAPTURES, name) : path.join(dir, name);
  const dest = path.join(kind === "clip" ? clipsDir : stillsDir, path.basename(name));
  if (!existsSync(src)) { console.warn(`  ⚠ missing capture ${name} — placeholder will be used`); return kind === "clip" ? null : "assets/brand/placeholder.png"; }
  copyFileSync(src, dest);
  return `assets/${kind === "clip" ? "clips" : "stills"}/${path.basename(name)}`;
}

// ---------- shared CSS / JS ----------
const CURSOR_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z" fill="#fff" stroke="#15181D" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const baseCss = (dark) => `
  ${FONT_FACES}
  #root { position: absolute; inset: 0; overflow: hidden; background: ${dark ? B.deep : B.canvas}; color: ${dark ? "#fff" : B.ink}; font-family: ${B.sans}; }
  .grid { position: absolute; inset: 0; background-image: linear-gradient(${dark ? "rgba(255,255,255,.05)" : "rgba(21,24,29,.06)"} 1px, transparent 1px), linear-gradient(90deg, ${dark ? "rgba(255,255,255,.05)" : "rgba(21,24,29,.06)"} 1px, transparent 1px); background-size: 96px 96px; }
  .glow { position: absolute; width: 1400px; height: 1400px; border-radius: 50%; background: radial-gradient(circle, rgba(229,72,47,${dark ? ".28" : ".22"}) 0%, rgba(229,72,47,0) 60%); left: -300px; top: -500px; will-change: transform; }
  .eyebrow { position: absolute; font-family: ${B.mono}; font-weight: 600; font-size: 22px; letter-spacing: .16em; text-transform: uppercase; color: ${dark ? B.coral : B.coralDeep}; }
  .eyebrow .w, .hl .w, .sub .w, .line .w { display: inline-block; opacity: 0; will-change: transform; }
  .hl .w, .line .w { margin-right: .22em; }
  .accent { color: ${B.coral}; }
`;
const waterfallJs = `
  const F = 1 / ${FPS};
  function waterfall(sel, t0, opts = {}) {
    const ws = gsap.utils.toArray(sel + " .w"); let t = t0;
    ws.forEach((w, i) => { const a = i === 0; const y = a ? 80 : (opts.y || 48); const d = a ? 0.2 : (opts.d || 0.15);
      tl.set(w, { opacity: 1, y }, t); tl.to(w, { y: 0, duration: d, ease: "power4.out" }, t); t += d - (a ? -1 * F : 1.5 * F); });
    return t;
  }
  function glowDrift(sel, dur) { tl.fromTo(sel, { x: 0, y: 0 }, { x: 420, y: 160, duration: dur, ease: "none" }, 0); }
`;
const wrap = (id, dur, css, body, js) => `<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>${css}</style>
      <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${dur}">
${body}
      </div>
      <script>
        (() => {
          const tl = gsap.timeline({ paused: true });
          ${waterfallJs}
          ${js}
          window.__timelines["${id}"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
`;

// ---------- scene: title ----------
function titleScene(sc) {
  const p = sc.id;
  const css = baseCss(true) + `
  .mark { position: absolute; left: 80px; top: 80px; width: 84px; height: 84px; opacity: 0; }
  .brand { position: absolute; left: 184px; top: 92px; font-family: ${B.mono}; font-weight: 700; font-size: 30px; letter-spacing: -.02em; color: #fff; opacity: 0; }
  .brand em { font-style: normal; font-weight: 500; color: ${B.coral}; }
  .hl { position: absolute; left: 76px; top: 300px; width: 1500px; font-weight: 700; font-size: 112px; line-height: 1.02; letter-spacing: -.03em; color: #fff; }
  .rule { position: absolute; left: 80px; top: 700px; width: 260px; height: 5px; background: ${B.coral}; transform-origin: left center; }
  .sub { position: absolute; left: 80px; top: 740px; width: 1200px; font-size: 38px; line-height: 1.3; font-weight: 400; color: rgba(255,255,255,.85); }
  .sub .w { margin-right: .25em; }
  .kicker { position: absolute; right: 80px; top: 100px; font-family: ${B.mono}; font-size: 20px; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.55); opacity: 0; }
  `;
  const body = `
        <div class="grid"></div>
        <div class="glow" id="${p}-glow" data-layout-allow-overflow></div>
        <img class="mark" id="${p}-mark" src="assets/brand/meyousocial-publish-mark.svg" alt="" />
        <div class="brand" id="${p}-brand">MeYouSocial <em>Publisher</em></div>
        ${sc.kicker ? `<div class="kicker" id="${p}-kicker">${esc(sc.kicker)}</div>` : ""}
        <div class="hl" id="${p}-hl" data-layout-allow-overlap>${words(sc.headline)}</div>
        <div class="rule" id="${p}-rule"></div>
        ${sc.sub ? `<div class="sub" id="${p}-sub" data-layout-allow-overlap>${words(sc.sub)}</div>` : ""}`;
  const js = `
          glowDrift("#${p}-glow", ${sc.duration});
          tl.fromTo("#${p}-mark", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.3);
          tl.fromTo("#${p}-brand", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, 0.45);
          ${sc.kicker ? `tl.fromTo("#${p}-kicker", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.6);` : ""}
          waterfall("#${p}-hl", ${beat(sc.headlineAt ?? 0.9, sc)});
          tl.fromTo("#${p}-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.out" }, ${beat(sc.subAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.5), sc) - 0.2});
          ${sc.sub ? `waterfall("#${p}-sub", ${beat(sc.subAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.5), sc)}, { y: 40, d: 0.14 });` : ""}`;
  return wrap(p, sc.duration, css, body, js);
}

// ---------- scene: screen (footage card + story column + headline band) ----------
const CARD = { x: 80, y: 110, w: 1320, h: 742, k: 0.6875 };
function screenScene(sc) {
  const p = sc.id;
  const still = sc.still ? stage(sc.still, "still") : null;
  const clip = sc.clip ? stage(sc.clip.src, "clip") : null;
  const css = baseCss(false) + `
  .tag { left: 1460px; top: 110px; }
  .win { position: absolute; left: ${CARD.x}px; top: ${CARD.y}px; width: ${CARD.w}px; height: ${CARD.h}px; overflow: hidden; border-radius: 18px; border: 2px solid ${B.line}; box-shadow: 0 30px 80px rgba(21,24,29,.18); background: #fff; }
  .zo { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
  .zi { position: absolute; inset: 0; will-change: transform; }
  .win img, .win video { position: absolute; left: 0; top: 0; width: ${CARD.w}px; height: ${CARD.h}px; display: block; object-fit: cover; object-position: top left; }
  .cursor { position: absolute; left: 48%; top: 118%; width: 96px; height: 96px; z-index: 20; filter: drop-shadow(0 4px 6px rgba(0,0,0,.3)); pointer-events: none; will-change: transform; }
  .cursor svg { width: 100%; height: 100%; display: block; }
  .ring { position: absolute; width: 90px; height: 90px; border-radius: 50%; border: 4px solid ${B.coral}; opacity: 0; transform: translate(-50%,-50%) scale(.3); pointer-events: none; z-index: 19; }
  .col { position: absolute; left: 1460px; top: 170px; width: 380px; display: flex; flex-direction: column; gap: 22px; }
  .card { background: #fff; border: 2px solid ${B.line}; border-radius: 14px; padding: 22px 26px 24px; opacity: 0; box-sizing: border-box; }
  .card .k { font-family: ${B.mono}; font-weight: 600; font-size: 18px; letter-spacing: .14em; text-transform: uppercase; color: ${B.ink2}; margin-bottom: 8px; }
  .card .v { font-weight: 700; font-size: 64px; letter-spacing: -.03em; line-height: 1; color: ${B.coral}; font-variant-numeric: tabular-nums; }
  .card .t { font-weight: 600; font-size: 30px; line-height: 1.15; letter-spacing: -.01em; color: ${B.ink}; }
  .card .n { font-size: 22px; line-height: 1.3; color: ${B.ink2}; margin-top: 8px; }
  .quote { background: ${B.coralSoft}; border: 2px solid rgba(229,72,47,.35); border-radius: 14px; padding: 20px 24px; font-size: 26px; line-height: 1.3; font-weight: 500; color: ${B.ink}; opacity: 0; box-sizing: border-box; }
  .quote::before { content: "“"; color: ${B.coral}; font-weight: 700; }
  .quote::after { content: "”"; color: ${B.coral}; font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { font-family: ${B.sans}; font-weight: 600; font-size: 21px; padding: 10px 16px; border-radius: 999px; border: 2px solid ${B.ink}; background: #fff; color: ${B.ink}; opacity: 0; will-change: transform; }
  .chip.on { background: ${B.ink}; color: #fff; }
  .hlband { position: absolute; left: 80px; top: ${script.captions ? 866 : 890}px; width: 1400px; font-weight: 700; font-size: ${script.captions ? 58 : 72}px; line-height: 1.02; letter-spacing: -.025em; color: ${B.ink}; }
  .hlband .w { display: inline-block; opacity: 0; will-change: transform; margin-right: .22em; }
  `;
  const callouts = (sc.callouts || []).map((c, i) => {
    const id = `${p}-c${i}`;
    if (c.kind === "chips") return `<div class="chips" id="${id}">${c.items.map((s, j) => `<span class="chip${c.on === j ? " on" : ""}" id="${id}-${j}">${esc(s)}</span>`).join("")}</div>`;
    if (c.kind === "quote") return `<div class="quote" id="${id}">${esc(c.text)}</div>`;
    return `<div class="card" id="${id}">${c.label ? `<div class="k">${esc(c.label)}</div>` : ""}${c.value != null ? `<div class="v" id="${id}-v">${esc(c.value)}</div>` : ""}${c.title ? `<div class="t">${esc(c.title)}</div>` : ""}${c.note ? `<div class="n">${esc(c.note)}</div>` : ""}</div>`;
  }).join("\n          ");
  const media = clip
    ? `<video id="${p}-vid" class="clip" src="${clip}" data-start="0" data-duration="${sc.duration}" data-media-start="${sc.clip.start ?? 0}"${sc.clip.rate ? ` data-playback-rate="${sc.clip.rate}"` : ""} muted playsinline></video>`
    : `<img id="${p}-img" src="${still}" alt="" />`;
  const body = `
        <div class="grid"></div>
        <div class="glow" id="${p}-glow" data-layout-allow-overflow></div>
        <div class="eyebrow tag" id="${p}-tag" data-layout-allow-overlap>${words(sc.chapter || "")}</div>
        <div class="win" id="${p}-win">
          <div class="zo" id="${p}-zo" data-layout-allow-overflow><div class="zi" id="${p}-zi" data-layout-allow-overflow>${media}</div></div>
          ${sc.cursor ? `<div class="ring" id="${p}-ring"></div><div class="cursor" id="${p}-cur">${CURSOR_SVG}</div>` : ""}
        </div>
        <div class="col" id="${p}-col">
          ${callouts}
        </div>
        ${sc.headline ? `<div class="hlband" id="${p}-hl" data-layout-allow-overlap>${words(sc.headline)}</div>` : ""}`;

  // callouts on the spoken beat
  let coJs = "";
  (sc.callouts || []).forEach((c, i) => {
    const id = `#${p}-c${i}`;
    const at = beat(c.at ?? "w:" + Math.floor((i + 1) * wordCount(sc.narration) / ((sc.callouts.length || 1) + 1)), sc);
    if (c.kind === "chips") {
      coJs += `\n          gsap.utils.toArray("${id} .chip").forEach((el, j) => tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, ${at} + j * 0.07));`;
    } else {
      coJs += `\n          tl.fromTo("${id}", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, ${at});`;
      if (c.count != null) {
        coJs += `\n          { const el = document.querySelector("${id}-v"); const st = { v: 0 }; tl.to(st, { v: ${Number(c.count)}, duration: 1.2, ease: "power3.out", onUpdate: () => { el.textContent = ${c.prefix ? JSON.stringify(c.prefix) : '""'} + Math.round(st.v) + ${c.suffix ? JSON.stringify(c.suffix) : '""'}; } }, ${at} + 0.1); tl.fromTo("${id}-v", { scale: 0.7, transformOrigin: "0% 100%" }, { scale: 1, duration: 1.2, ease: "power3.out" }, ${at} + 0.1); }`;
      }
    }
  });

  // punch-ins: {x,y,scale,at,dur,hold} in 1920x1080 frame coords
  let punchJs = "";
  (sc.punches || (sc.punch ? [sc.punch] : [])).forEach((pz) => {
    const s = pz.scale ?? 1.35;
    let tx = -(pz.x * CARD.k - CARD.w / 2), ty = -(pz.y * CARD.k - CARD.h / 2);
    const mx = (CARD.w / 2) * (1 - 1 / s), my = (CARD.h / 2) * (1 - 1 / s);
    tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
    const at = beat(pz.at, sc), d = pz.dur ?? 1.6, hold = pz.hold ?? 2.5;
    punchJs += `\n          tl.to("#${p}-zo", { scale: ${s}, duration: ${d}, ease: "power2.inOut" }, ${at}); tl.to("#${p}-zi", { x: ${r1(tx)}, y: ${r1(ty)}, duration: ${d}, ease: "power2.inOut" }, ${at});`;
    if (pz.back !== false) {
      const back = r1(at + d + hold);
      if (back + 1.2 < sc.duration) punchJs += `\n          tl.to("#${p}-zo", { scale: 1, duration: 1.2, ease: "power3.inOut" }, ${back}); tl.to("#${p}-zi", { x: 0, y: 0, duration: 1.2, ease: "power3.inOut" }, ${back});`;
    }
  });

  // cursor: [{x,y,at,click}] frame coords → card %; enters from below, exits right
  let curJs = "";
  if (sc.cursor && sc.cursor.length) {
    const pts = sc.cursor.map((c) => ({ ...c, lx: r1((c.x * CARD.k / CARD.w) * 100), ly: r1((c.y * CARD.k / CARD.h) * 100), t: beat(c.at, sc) }));
    const f = pts[0];
    // tip offset: the arrow tip sits at 21%/14% of the box → shift box so tip = target
    const tipX = 96 * 0.21, tipY = 96 * 0.14;
    curJs += `\n          gsap.set("#${p}-cur", { x: -${tipX}, y: -${tipY} });`;
    curJs += `\n          tl.fromTo("#${p}-cur", { left: "${f.lx}%", top: "118%" }, { left: "${f.lx}%", top: "${f.ly}%", duration: 0.85, ease: "power3.out", immediateRender: false }, ${r3(f.t - 0.85)});`;
    pts.forEach((c, i) => {
      if (i > 0) curJs += `\n          tl.to("#${p}-cur", { left: "${c.lx}%", top: "${c.ly}%", duration: ${r3(Math.max(0.4, Math.min(1.1, c.t - pts[i - 1].t - 0.2)))}, ease: "power2.inOut" }, ${r3(c.t - Math.max(0.4, Math.min(1.1, c.t - pts[i - 1].t - 0.2)))});`;
      if (c.click) {
        curJs += `\n          tl.to("#${p}-cur", { scale: 0.84, duration: 0.1, ease: "power2.in", transformOrigin: "21% 14%" }, ${c.t}); tl.to("#${p}-cur", { scale: 1, duration: 0.22, ease: "power2.out", transformOrigin: "21% 14%" }, ${r3(c.t + 0.1)});`;
        curJs += `\n          tl.set("#${p}-ring", { left: "${c.lx}%", top: "${c.ly}%", opacity: 0.9, scale: 0.3 }, ${c.t}); tl.to("#${p}-ring", { scale: 1.6, opacity: 0, duration: 0.55, ease: "power2.out" }, ${c.t});`;
      }
    });
    const last = pts[pts.length - 1];
    const exitAt = sc.cursorExit != null ? beat(sc.cursorExit, sc) : r1(Math.min(sc.duration - 0.6, last.t + 1.6));
    curJs += `\n          tl.to("#${p}-cur", { left: "118%", duration: 0.6, ease: "power2.in" }, ${exitAt});`;
  }

  const js = `
          glowDrift("#${p}-glow", ${sc.duration});
          waterfall("#${p}-tag", 0.3, { y: 36, d: 0.12 });
          ${sc.headline ? `waterfall("#${p}-hl", ${beat(sc.headlineAt ?? 0.7, sc)});` : ""}${coJs}${punchJs}${curJs}`;
  return wrap(p, sc.duration, css, body, js);
}

// ---------- scene: flow (the seven-stage loop or any chain) ----------
function flowScene(sc) {
  const p = sc.id;
  const nodes = sc.nodes || [];
  const n = nodes.length;
  const gap = 24, total = 1760, w = Math.floor((total - gap * (n - 1)) / n);
  const css = baseCss(false) + `
  .tag { left: 80px; top: 110px; }
  .flow { position: absolute; left: 80px; top: 330px; width: 1760px; height: 260px; }
  .node { position: absolute; top: 0; width: ${w}px; height: 220px; border: 2px solid ${B.line}; border-radius: 16px; background: #fff; padding: 22px 22px; box-sizing: border-box; opacity: 0; will-change: transform; }
  .node .n { font-family: ${B.mono}; font-weight: 600; font-size: 16px; letter-spacing: .16em; text-transform: uppercase; color: ${B.ink2}; margin-bottom: 10px; }
  .node .t { font-weight: 700; font-size: 34px; letter-spacing: -.02em; line-height: 1.05; margin-bottom: 8px; color: ${B.ink}; }
  .node .d { font-size: 20px; line-height: 1.3; color: ${B.ink2}; }
  .node.hot { border-color: ${B.coral}; box-shadow: 0 18px 50px rgba(229,72,47,.18); }
  .node.hot .t { color: ${B.coral}; }
  .link { position: absolute; top: 106px; height: 3px; background: ${B.ink}; transform-origin: left center; }
  .link::after { content: ''; position: absolute; right: -2px; top: -7px; border: 8px solid transparent; border-left: 12px solid ${B.ink}; }
  .loop { position: absolute; left: 80px; top: 600px; width: 1760px; height: 3px; background: ${B.coral}; transform-origin: right center; opacity: 0; }
  .hlband { position: absolute; left: 80px; top: 740px; width: 1600px; font-weight: 700; font-size: 84px; line-height: 1.02; letter-spacing: -.03em; color: ${B.ink}; }
  .hlband .w { display: inline-block; opacity: 0; will-change: transform; margin-right: .22em; }
  .sub { position: absolute; left: 80px; top: 940px; width: 1500px; font-size: 32px; line-height: 1.3; color: ${B.ink2}; }
  .sub .w { margin-right: .25em; }
  `;
  const body = `
        <div class="grid"></div>
        <div class="glow" id="${p}-glow" data-layout-allow-overflow></div>
        <div class="eyebrow tag" id="${p}-tag" data-layout-allow-overlap>${words(sc.chapter || "")}</div>
        <div class="flow">
          ${nodes.map((nd, i) => `<div class="node${nd.hot ? " hot" : ""}" id="${p}-n${i}" style="left:${i * (w + gap)}px"><div class="n">${esc(nd.n || String(i + 1).padStart(2, "0"))}</div><div class="t">${esc(nd.t)}</div><div class="d">${esc(nd.d || "")}</div></div>${i < n - 1 ? `<div class="link" id="${p}-l${i}" style="left:${i * (w + gap) + w - 2}px;width:${gap + 4}px"></div>` : ""}`).join("\n          ")}
        </div>
        ${sc.loop ? `<div class="loop" id="${p}-loop" data-layout-allow-overflow></div>` : ""}
        ${sc.headline ? `<div class="hlband" id="${p}-hl" data-layout-allow-overlap>${words(sc.headline)}</div>` : ""}
        ${sc.sub ? `<div class="sub" id="${p}-sub" data-layout-allow-overlap>${words(sc.sub)}</div>` : ""}`;
  const nodeStart = beat(sc.nodesAt ?? "w:2", sc);
  const nodeEnd = beat(sc.nodesEnd ?? "w:" + Math.floor(wordCount(sc.narration) * 0.6), sc);
  const step = n > 1 ? (nodeEnd - nodeStart) / (n - 1) : 0;
  const js = `
          glowDrift("#${p}-glow", ${sc.duration});
          waterfall("#${p}-tag", 0.3, { y: 36, d: 0.12 });
          ${nodes.map((_, i) => `tl.fromTo("#${p}-n${i}", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, ${r3(nodeStart + i * step)});${i < n - 1 ? ` tl.fromTo("#${p}-l${i}", { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power2.out" }, ${r3(nodeStart + i * step + 0.4)});` : ""}`).join("\n          ")}
          ${sc.loop ? `tl.fromTo("#${p}-loop", { opacity: 1, scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power3.inOut" }, ${r3(nodeEnd + 0.6)});` : ""}
          ${sc.headline ? `waterfall("#${p}-hl", ${beat(sc.headlineAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.7), sc)});` : ""}
          ${sc.sub ? `waterfall("#${p}-sub", ${beat(sc.subAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.85), sc)}, { y: 40, d: 0.14 });` : ""}`;
  return wrap(p, sc.duration, css, body, js);
}

// ---------- scene: close ----------
function closeScene(sc) {
  const p = sc.id;
  const css = baseCss(true) + `
  .line { position: absolute; left: 76px; top: 260px; width: 1600px; font-weight: 700; font-size: 104px; line-height: 1.02; letter-spacing: -.03em; color: #fff; }
  .lockup { position: absolute; left: 80px; top: 660px; width: 760px; opacity: 0; }
  .lockup img { width: 100%; display: block; }
  .tag2 { position: absolute; left: 80px; top: 900px; font-family: ${B.mono}; font-size: 24px; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.7); opacity: 0; }
  .tag2 em { font-style: normal; color: ${B.coral}; }
  .url { position: absolute; right: 80px; top: 900px; font-family: ${B.mono}; font-weight: 600; font-size: 28px; letter-spacing: .02em; color: #fff; opacity: 0; }
  `;
  const body = `
        <div class="grid"></div>
        <div class="glow" id="${p}-glow" data-layout-allow-overflow></div>
        <div class="line" id="${p}-line" data-layout-allow-overlap>${words(sc.line)}</div>
        <div class="lockup" id="${p}-lockup"><img src="assets/brand/meyousocial-publisher-lockup-dark.svg" alt="" /></div>
        <div class="tag2" id="${p}-tag2">${esc(sc.tagline || "One loop from research to results")} <em>·</em> ${esc(sc.tagline2 || "Your job is decisions, not production")}</div>
        <div class="url" id="${p}-url">${esc(sc.url || "meyousocial.com")}</div>`;
  const js = `
          glowDrift("#${p}-glow", ${sc.duration});
          waterfall("#${p}-line", ${beat(sc.lineAt ?? 0.7, sc)});
          tl.fromTo("#${p}-lockup", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, ${beat(sc.lockupAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.55), sc)});
          tl.fromTo("#${p}-tag2", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${beat(sc.lockupAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.55), sc) + 0.5});
          tl.fromTo("#${p}-url", { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${beat(sc.lockupAt ?? "w:" + Math.floor(wordCount(sc.narration) * 0.55), sc) + 0.7});`;
  return wrap(p, sc.duration, css, body, js);
}

// ---------- 4. write scenes ----------
const builders = { title: titleScene, screen: screenScene, flow: flowScene, close: closeScene };
for (const sc of script.scenes) {
  const html = (builders[sc.type] || screenScene)(sc);
  writeFileSync(path.join(dir, "compositions", `${sc.id}.html`), html);
}


// ---------- caption text alignment ----------
// Captions must read as WRITTEN, not as Whisper heard it. Whisper supplies timing only; the words
// come from the script. Without this the burned-in rail printed "me, you social publisher" for the
// brand, "G of four" for GA4, and the odd hallucinated phrase on a quiet tail.
function alignToScript(text, words) {
  const disp = String(text || "").replace(/\*/g, "").split(/\s+/).filter(Boolean);
  if (!disp.length || !words || !words.length) return [];
  const norm = (t) => t.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, "");
  const a = disp.map(norm), b = words.map((w) => norm(w.w));
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = disp.map((w) => ({ w, s: null, e: null }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { out[i].s = words[j].s; out[i].e = words[j].e; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // words the transcript never matched get time interpolated between the nearest anchors
  const firstT = words[0].s, lastT = words[words.length - 1].e;
  let prevIdx = -1, prevT = firstT;
  for (let k = 0; k <= n; k++) {
    if (k === n || out[k].s != null) {
      const nextT = k === n ? lastT : out[k].s;
      const gap = k - prevIdx - 1;
      if (gap > 0) {
        const step = (nextT - prevT) / (gap + 1);
        for (let g = 1; g <= gap; g++) {
          const t = prevT + step * g;
          out[prevIdx + g] = { w: out[prevIdx + g].w, s: t, e: t + Math.max(0.08, step * 0.9) };
        }
      }
      if (k < n) { prevIdx = k; prevT = out[k].e; }
    }
  }
  if (out[0].s == null) { out[0].s = firstT; out[0].e = firstT + 0.1; }
  return out;
}

// ---------- 5. index.html ----------
const slots = script.scenes.map((sc) => `      <div id="el-${sc.id}" data-composition-id="${sc.id}" data-composition-src="compositions/${sc.id}.html" data-start="${sc.start}" data-duration="${sc.duration}" data-track-index="1" data-width="1920" data-height="1080"></div>`).join("\n");
const audios = script.scenes.map((sc) => `      <audio id="vo-${sc.id}" src="assets/vo/${sc.id}.wav" data-start="${r1(sc.start + sc.lead)}" data-duration="${sc.voice.toFixed(3)}" data-track-index="10" data-volume="1"></audio>`).join("\n");

// ---------- captions (verbatim rail, from Whisper word timings) ----------
let captions = "";
if (script.captions) {
  const cues = [];
  let swapped = 0;
  for (const sc of script.scenes) {
    if (!sc.words || !sc.words.length) continue;
    const spoken = alignToScript(sc.narration || sc.line || "", sc.words);
    const capWords = spoken.length ? spoken : sc.words;
    if (spoken.length) swapped++;
    const base = sc.start + sc.lead;
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const s = base + cur[0].s, e = base + cur[cur.length - 1].e + 0.12;
      cues.push({ s: r3(s), e: r3(Math.min(e, sc.start + sc.duration)), text: cur.map((w) => w.w).join(" ") });
      cur = [];
    };
    for (const w of capWords) {
      const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
      const gap = cur.length ? w.s - cur[cur.length - 1].e : 0;
      if (cur.length && (len > 64 || gap > 0.7 || /[.!?]$/.test(cur[cur.length - 1].w) && len > 30)) flush();
      cur.push(w);
    }
    flush();
  }
  // never overlap the next cue; a cue that would be shorter than 0.9 s merges into the next one
  for (let i = 0; i < cues.length; i++) {
    if (cues[i + 1] && cues[i].e > cues[i + 1].s) cues[i].e = cues[i + 1].s;
    if (cues[i + 1] && cues[i].e - cues[i].s < 0.9 && cues[i + 1].text.length + cues[i].text.length < 90) {
      cues[i + 1] = { s: cues[i].s, e: cues[i + 1].e, text: cues[i].text + " " + cues[i + 1].text };
      cues.splice(i, 1); i--; continue;
    }
    if (!cues[i + 1] && cues[i].e - cues[i].s < 0.9) cues[i].e = r3(cues[i].s + 0.9);
  }
  captions = cues.map((c, i) => `      <div id="cap-${i}" class="clip cap" data-start="${c.s}" data-duration="${r3(c.e - c.s)}" data-track-index="5" data-layout-allow-overlap><span>${esc(c.text)}</span></div>`).join("\n");
  console.log(`captions: ${cues.length} cues (${swapped} scenes aligned to script text)`);
}
const capCss = script.captions ? `
      ${FONT_FACES}
      .cap { position: absolute; left: 260px; width: 1400px; bottom: 26px; display: flex; justify-content: center; align-items: flex-end; pointer-events: none; }
      .cap span { display: inline-block; max-width: 1200px; padding: 9px 24px 11px; border-radius: 12px; background: rgba(255,255,255,.94); box-shadow: 0 8px 30px rgba(21,24,29,.15); text-align: center; font-family: ${B.sans}; font-weight: 600; font-size: 34px; line-height: 1.25; color: ${B.ink}; }` : "";
const index = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${esc(script.title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: ${B.deep}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${B.deep}; /* opaque stage ground — white-flash guard */ }
      #root > div[data-composition-src] { position: absolute; inset: 0; will-change: transform, opacity, filter; }${capCss}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="${TOTAL}">
${slots}

      <!-- Narration: one Kokoro line per scene (${VOICE}); lead-in baked into data-start -->
${audios}
${captions}
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      // <seams:auto>
      // </seams:auto>
      tl.set({}, {}, ${TOTAL});
    </script>
  </body>
</html>
`;
writeFileSync(path.join(dir, "index.html"), index);

// ---------- 6. ledger + stamp ----------
const seams = [];
for (let i = 1; i < script.scenes.length; i++) {
  const a = script.scenes[i - 1], b = script.scenes[i];
  let row;
  if (b.seam === "arrival") row = { id: `${a.id}→${b.id}`, cut: b.start, technique: "inverse zoom-through", exit: { selector: `#el-${a.id}`, axis: "z", dir: -1 }, entry: { selector: `#el-${b.id}`, axis: "z", dir: -1, scanRoot: `#el-${b.id}` }, blur: 18 };
  else if (b.seam === "up" || b.type === "close") row = { id: `${a.id}→${b.id}`, cut: b.start, technique: "cut-the-curve UP", exit: { selector: `#el-${a.id}`, axis: "y", dir: -1 }, entry: { selector: `#el-${b.id}`, axis: "y", dir: -1 } };
  else row = { id: `${a.id}→${b.id}`, cut: b.start, technique: "cut-the-curve LEFT", exit: { selector: `#el-${a.id}`, axis: "x", dir: -1 }, entry: { selector: `#el-${b.id}`, axis: "x", dir: -1 } };
  seams.push(row);
}
writeFileSync(path.join(dir, "ledger.json"), JSON.stringify({ fps: FPS, current: "LEFT", seams }, null, 2));
if (existsSync(SEAM_STAMP)) {
  const r = spawnSync("node", [SEAM_STAMP, "--ledger", "ledger.json", "--write", "index.html"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) console.error(r.stdout, r.stderr); else console.log("seams stamped:", seams.length);
} else console.warn("seam-stamp.mjs not found at", SEAM_STAMP);

// ---------- 7. SCRIPT.md + STORYBOARD.md ----------
const scriptMd = `# ${script.title} — narration\n\n_Voice: Kokoro ${VOICE}. Total ${TOTAL}s._\n\n` + script.scenes.map((sc) => `## ${sc.id} · ${sc.type}${sc.chapter ? ` · ${sc.chapter}` : ""} (${sc.voice.toFixed(1)}s voice, ${sc.duration}s scene, starts ${sc.start}s)\n\n${sc.narration.replace(/\*/g, "")}\n`).join("\n");
writeFileSync(path.join(dir, "SCRIPT.md"), scriptMd);
const sb = `---\ntitle: ${script.title}\nmessage: "${script.message || ""}"\naudience: "${script.audience || ""}"\nmode: autonomous\nduration: ${TOTAL}\n---\n\n` + script.scenes.map((sc, i) => `## Frame ${i + 1} — ${sc.id}\n\nstatus: animated\nsrc: compositions/${sc.id}.html\nstart: ${sc.start}\nduration: ${sc.duration}\ntype: ${sc.type}\nseam-in: ${i === 0 ? "—" : seams[i - 1].technique}\nroute: ${sc.type === "screen" ? (sc.cursor ? "cursor-led action + staged reveals" : sc.punches || sc.punch ? "camera with intent + staged reveals" : "staged reveals") : "staged reveals (waterfall entry)"}\nfootage: ${sc.still || (sc.clip && sc.clip.src) || "—"}\n\n> ${sc.narration.replace(/\*/g, "")}\n`).join("\n");
writeFileSync(path.join(dir, "STORYBOARD.md"), sb);

console.log(`\n${script.id}: ${script.scenes.length} scenes, ${TOTAL}s total → ${path.relative(process.cwd(), dir) || "."}`);
script.scenes.forEach((sc) => console.log(`  ${sc.id} ${sc.type.padEnd(6)} start ${String(sc.start).padStart(6)}  voice ${sc.voice.toFixed(1)}s  scene ${sc.duration}s`));
