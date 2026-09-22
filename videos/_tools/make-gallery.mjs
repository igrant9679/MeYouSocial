// make-gallery.mjs — self-contained HTML gallery for _deliverables (reads index.json, embeds it).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DELIV = path.resolve(import.meta.dirname, "../_deliverables");
const data = JSON.parse(readFileSync(path.join(DELIV, "index.json"), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const card = (v) => `
      <article class="card" data-set="${v.set}" data-search="${esc((v.title + " " + v.description + " " + v.tags.join(" ") + " " + v.chapters.map((c) => c.title).join(" ")).toLowerCase())}" data-id="${v.id}">
        <button class="thumb" type="button" data-play="${v.id}" aria-label="Play ${esc(v.title)}">
          <img src="posters/${v.id}.jpg" alt="" loading="lazy" width="960" height="540" />
          <span class="dur">${v.duration}</span>
          <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
        </button>
        <div class="meta">
          <div class="eyebrow">${v.set} · ${v.number}${v.captions ? ' · <span class="cc">CC</span>' : ""}</div>
          <h3>${esc(v.title)}</h3>
          <p>${esc(v.description)}</p>
          <div class="tags">${v.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
        </div>
      </article>`;

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MeYouSocial Publisher video library</title>
<meta name="description" content="Six demo videos and twelve training walkthroughs for MeYouSocial Publisher." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --canvas: #FBF7F5; --panel: #FFFFFF; --ink: #15181D; --ink-2: #4A4F58; --line: rgba(21,24,29,.14);
    --coral: #E5482F; --coral-deep: #B5371F; --coral-soft: #FDE7E1; --deep: #15181D; --shadow: 0 18px 50px rgba(21,24,29,.12);
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --canvas: #15181D; --panel: #1E2229; --ink: #F4F1EF; --ink-2: #B4B9C2; --line: rgba(255,255,255,.14); --coral-soft: rgba(229,72,47,.18); --shadow: 0 18px 50px rgba(0,0,0,.4); } }
  :root[data-theme="dark"] { --canvas: #15181D; --panel: #1E2229; --ink: #F4F1EF; --ink-2: #B4B9C2; --line: rgba(255,255,255,.14); --coral-soft: rgba(229,72,47,.18); --shadow: 0 18px 50px rgba(0,0,0,.4); }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--canvas); color: var(--ink); font-family: "IBM Plex Sans", system-ui, sans-serif; line-height: 1.45; }
  .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
  header.hero { background: var(--deep); color: #fff; padding: 56px 16px 48px; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
  .brand { display: flex; align-items: center; gap: 14px; font-family: "IBM Plex Mono", monospace; font-weight: 700; font-size: 22px; letter-spacing: -.02em; }
  .brand em { font-style: normal; font-weight: 500; color: var(--coral); }
  .brand svg { width: 44px; height: 44px; border-radius: 10px; }
  .hero h1 { font-size: clamp(32px, 5vw, 56px); line-height: 1.05; letter-spacing: -.03em; margin: 28px 0 12px; max-width: 16ch; }
  .hero h1 span { color: var(--coral); }
  .hero p { color: rgba(255,255,255,.78); max-width: 62ch; margin: 0 0 22px; font-size: 18px; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px 22px; font-family: "IBM Plex Mono", monospace; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.66); }
  .stats b { color: #fff; font-weight: 700; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 22px 0 6px; position: sticky; top: 0; background: var(--canvas); z-index: 5; }
  .tabs { display: flex; gap: 6px; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 4px; }
  .tabs button { border: 0; background: transparent; color: var(--ink-2); font: inherit; font-weight: 600; font-size: 14px; padding: 8px 16px; border-radius: 999px; cursor: pointer; }
  .tabs button[aria-pressed="true"] { background: var(--ink); color: #fff; }
  .search { flex: 1 1 220px; min-width: 200px; display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; }
  .search input { border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 15px; width: 100%; outline: none; }
  .search svg { width: 18px; height: 18px; color: var(--ink-2); flex: none; }
  section.set { padding: 22px 0 10px; }
  section.set h2 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 4px; }
  section.set .lede { margin: 0 0 18px; color: var(--ink-2); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 22px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 0 rgba(21,24,29,.04); transition: transform .18s ease, box-shadow .18s ease; }
  .card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .card.hidden { display: none; }
  .thumb { position: relative; display: block; width: 100%; padding: 0; border: 0; background: #000; cursor: pointer; aspect-ratio: 16 / 9; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s ease; }
  .thumb:hover img { transform: scale(1.03); }
  .thumb .dur { position: absolute; right: 10px; bottom: 10px; background: rgba(21,24,29,.85); color: #fff; font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; }
  .thumb .play { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transition: opacity .18s; background: rgba(21,24,29,.25); }
  .thumb:hover .play, .thumb:focus-visible .play { opacity: 1; }
  .thumb .play svg { width: 64px; height: 64px; fill: #fff; filter: drop-shadow(0 4px 12px rgba(0,0,0,.4)); }
  .meta { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--coral-deep); }
  .cc { border: 1.5px solid currentColor; border-radius: 4px; padding: 0 4px; font-size: 10px; }
  .meta h3 { margin: 0; font-size: 19px; line-height: 1.25; letter-spacing: -.01em; }
  .meta p { margin: 0; color: var(--ink-2); font-size: 15px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
  .tags span { font-size: 12px; font-weight: 600; color: var(--ink-2); background: var(--canvas); border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; }
  .empty { color: var(--ink-2); padding: 30px 0; }
  footer { padding: 40px 16px 56px; color: var(--ink-2); font-size: 14px; }
  footer .wrap { border-top: 1px solid var(--line); padding-top: 20px; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; }
  /* player */
  dialog.player { border: 0; padding: 0; background: transparent; max-width: min(1200px, 96vw); width: 96vw; }
  dialog.player::backdrop { background: rgba(21,24,29,.82); backdrop-filter: blur(6px); }
  .player-inner { background: var(--panel); color: var(--ink); border-radius: 18px; overflow: hidden; display: grid; grid-template-columns: 1fr; box-shadow: 0 40px 120px rgba(0,0,0,.5); }
  @media (min-width: 960px) { .player-inner { grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr); } }
  .player-inner video { width: 100%; height: auto; display: block; background: #000; aspect-ratio: 16 / 9; }
  .side { padding: 20px 22px 22px; display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow: auto; }
  .side h2 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -.02em; }
  .side p { margin: 0; color: var(--ink-2); font-size: 15px; }
  .side .line { font-size: 15px; font-weight: 500; }
  .chapters { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .chapters button { width: 100%; text-align: left; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 8px; cursor: pointer; display: flex; gap: 12px; }
  .chapters button:hover, .chapters button.active { background: var(--coral-soft); }
  .chapters .t { font-family: "IBM Plex Mono", monospace; font-weight: 600; color: var(--coral-deep); flex: none; }
  .side .actions { display: flex; gap: 8px; margin-top: auto; padding-top: 8px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid var(--line); background: var(--panel); color: var(--ink); }
  .btn.primary { background: var(--coral); border-color: var(--coral); color: #fff; }
  .close { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(21,24,29,.7); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
  .playwrap { position: relative; }
  .kbd { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--ink-2); }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <div class="brand">
      <svg viewBox="0 0 520 520" aria-hidden="true"><rect width="520" height="520" rx="110" fill="#15181D" stroke="#fff" stroke-opacity=".18" stroke-width="6"/><path d="M90 410 V140 L225 320 L270 255 V410 Z" fill="#fff"/><path d="M270 255 L315 320 L430 140 V410 H345 V280 Z" fill="#E5482F"/><circle cx="418" cy="418" r="86" fill="#fff" stroke="#15181D" stroke-width="16"/><g fill="none" stroke="#E5482F" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M386 450 L450 386"/><path d="M404 386 H450 V432"/></g></svg>
      <span>MeYouSocial <em>Publisher</em></span>
    </div>
    <h1>Video <span>library.</span></h1>
    <p>Six short demos of what Publisher does, and twelve training walkthroughs of how to run it. Every video shows the real product, with a person's job kept where it belongs: decisions, not production.</p>
    <div class="stats"><span><b>${data.videos.length}</b> videos</span><span><b>${data.totalDuration}</b> total</span><span><b>1080p</b> · 30 fps</span><span><b>Captions</b> on training</span></div>
  </div>
</header>

<main class="wrap">
  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="Video set">
      <button type="button" data-filter="all" aria-pressed="true">All</button>
      <button type="button" data-filter="Demo" aria-pressed="false">Demos</button>
      <button type="button" data-filter="Training" aria-pressed="false">Training</button>
    </div>
    <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search titles, topics, chapters…" aria-label="Search videos" /></label>
  </div>

  <section class="set" data-set="Demo">
    <h2>Demos</h2>
    <p class="lede">Value-first overviews, about two minutes each. Start with D1.</p>
    <div class="grid">${data.videos.filter((v) => v.set === "Demo").map(card).join("")}
    </div>
  </section>

  <section class="set" data-set="Training">
    <h2>Training</h2>
    <p class="lede">Task walkthroughs with captions, designed to be watched in order. Each one hands off to the next.</p>
    <div class="grid">${data.videos.filter((v) => v.set === "Training").map(card).join("")}
    </div>
  </section>
  <p class="empty" id="empty" hidden>No videos match that search.</p>
</main>

<footer><div class="wrap"><span>MeYouSocial Publisher · ${data.videos.length} videos · ${data.totalDuration}</span><span class="kbd">Space play/pause · ← → seek 5 s · Esc close</span></div></footer>

<dialog class="player" id="player" aria-label="Video player">
  <div class="player-inner">
    <div class="playwrap">
      <video id="vid" controls playsinline preload="metadata"></video>
      <button class="close" type="button" id="close" aria-label="Close">×</button>
    </div>
    <aside class="side">
      <div class="eyebrow" id="p-eyebrow"></div>
      <h2 id="p-title"></h2>
      <p class="line" id="p-message"></p>
      <p id="p-desc"></p>
      <div class="eyebrow">Chapters</div>
      <ul class="chapters" id="p-chapters"></ul>
      <div class="actions">
        <a class="btn primary" id="p-download" download>Download MP4</a>
        <button class="btn" type="button" id="p-copy">Copy link</button>
      </div>
    </aside>
  </div>
</dialog>

<script>
  const DATA = ${JSON.stringify(data.videos.map((v) => ({ id: v.id, set: v.set, number: v.number, title: v.title, file: v.file, message: v.message, description: v.description, chapters: v.chapters, captions: v.captions, duration: v.duration })))};
  const byId = Object.fromEntries(DATA.map((v) => [v.id, v]));
  const toSec = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);
  const dlg = document.getElementById("player"), vid = document.getElementById("vid");
  let current = null;

  function open(id, seek) {
    const v = byId[id]; if (!v) return; current = v;
    document.getElementById("p-eyebrow").innerHTML = v.set + " · " + v.number + " · " + v.duration + (v.captions ? ' · <span class="cc">CC</span>' : "");
    document.getElementById("p-title").textContent = v.title;
    document.getElementById("p-message").textContent = v.message;
    document.getElementById("p-desc").textContent = v.description;
    const ul = document.getElementById("p-chapters"); ul.innerHTML = "";
    v.chapters.forEach((c) => { const li = document.createElement("li"); const b = document.createElement("button"); b.type = "button"; b.innerHTML = '<span class="t">' + c.time + "</span><span>" + c.title + "</span>"; b.dataset.t = toSec(c.time); b.onclick = () => { vid.currentTime = Number(b.dataset.t); vid.play(); }; li.appendChild(b); ul.appendChild(li); });
    const dl = document.getElementById("p-download"); dl.href = v.file; dl.setAttribute("download", v.file);
    vid.src = v.file; vid.poster = "posters/" + v.id + ".jpg";
    if (!dlg.open) dlg.showModal();
    vid.currentTime = seek || 0; vid.play().catch(() => {});
    history.replaceState(null, "", "#" + v.id);
  }
  function close() { vid.pause(); vid.removeAttribute("src"); vid.load(); dlg.close(); history.replaceState(null, "", location.pathname); }
  document.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => open(b.dataset.play)));
  document.getElementById("close").onclick = close;
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  vid.addEventListener("timeupdate", () => { const t = vid.currentTime; let active = null; document.querySelectorAll("#p-chapters button").forEach((b) => { if (Number(b.dataset.t) <= t) active = b; b.classList.remove("active"); }); if (active) active.classList.add("active"); });
  document.getElementById("p-copy").onclick = async () => { const url = location.origin + location.pathname + "#" + current.id; try { await navigator.clipboard.writeText(url); document.getElementById("p-copy").textContent = "Copied"; setTimeout(() => (document.getElementById("p-copy").textContent = "Copy link"), 1400); } catch { prompt("Link", url); } };
  document.addEventListener("keydown", (e) => { if (!dlg.open) return; if (e.key === " " && e.target === document.body) { e.preventDefault(); vid.paused ? vid.play() : vid.pause(); } if (e.key === "ArrowRight") vid.currentTime += 5; if (e.key === "ArrowLeft") vid.currentTime -= 5; });

  // filter + search
  let filter = "all";
  const q = document.getElementById("q");
  function apply() {
    const term = q.value.trim().toLowerCase(); let shown = 0;
    document.querySelectorAll(".card").forEach((c) => { const ok = (filter === "all" || c.dataset.set === filter) && (!term || c.dataset.search.includes(term)); c.classList.toggle("hidden", !ok); if (ok) shown++; });
    document.querySelectorAll("section.set").forEach((s) => { s.hidden = (filter !== "all" && s.dataset.set !== filter) || !s.querySelector(".card:not(.hidden)"); });
    document.getElementById("empty").hidden = shown > 0;
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); apply(); }));
  q.addEventListener("input", apply);
  try { const saved = localStorage.getItem("mys-gallery-filter"); if (saved) { filter = saved; document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filter === saved))); apply(); } } catch {}
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("mys-gallery-filter", b.dataset.filter); } catch {} }));
  if (location.hash && byId[location.hash.slice(1)]) open(location.hash.slice(1));
</script>
</body>
</html>
`;
writeFileSync(path.join(DELIV, "index.html"), html);
console.log("gallery written:", path.join(DELIV, "index.html"), Math.round(html.length / 1024) + " KB");
