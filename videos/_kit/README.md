# Video kit — how a Publisher video is built

`frame.md` is the design truth. `assets/` holds the brand files copied into every project. `_tools/build.mjs` turns a `script.json` into narration, scene compositions, a master `index.html`, a seam ledger and stamped seams.

## Make a video

```bash
# 1. scaffold (once per video; init refuses a non-empty folder)
HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init videos/<slug> --non-interactive --example=blank --skill=general-video
# 2. write videos/<slug>/script.json (shape below), then
node videos/_tools/build.mjs videos/<slug>
# 3. verify + render (from inside the project)
npx hyperframes lint && npx hyperframes check
node ~/.claude/skills/motion-doctrine/scripts/seam-gate.mjs verify --ledger ledger.json --project .
npx hyperframes snapshot . --at <scene midpoints>
npx hyperframes render --output renders/<slug>.mp4
```

## script.json

```jsonc
{
  "id": "d01-the-loop", "title": "Publisher in two minutes", "kind": "demo",
  "voice": "am_michael", "speed": 1,
  "message": "One loop from research to results, mostly on its own",
  "scenes": [
    { "id": "s01", "type": "title", "kicker": "Demo · 01",
      "headline": "A machine, with a person at the *gates.*",   // *word* = coral accent (on-screen only)
      "sub": "MeYouSocial Publisher, in two minutes.",
      "narration": "Spoken text. Say 'Publisher', never 'Publish'." },
    { "id": "s02", "type": "screen", "chapter": "01 · The Inbox",
      "still": "inbox.png",                    // from videos/_captures (or "clip": {"src":"rail-tour.mp4","start":0,"rate":1})
      "headline": "Whatever it can't fix waits for *you.*",
      "callouts": [                            // land on the spoken beat: "w:12" = 12th word, "q:phrase" = where the phrase starts, or seconds
        { "kind": "card", "label": "Every", "value": "30 min", "title": "one autopilot sweep", "at": "q:Every thirty" },
        { "kind": "chips", "items": ["Discovers ideas", "Drafts approved ideas"], "on": 1, "at": "q:It discovers" },
        { "kind": "quote", "text": "Questions only you can answer", "at": "q:waits here" },
        { "kind": "card", "label": "Networks", "value": "15", "count": 15, "title": "through one connection" }  // count-up
      ],
      "punch": { "x": 420, "y": 330, "scale": 1.35, "at": "q:waits here", "dur": 1.6, "hold": 2.5 },  // frame coords of a 1920×1080 capture
      "cursor": [ { "x": 300, "y": 400, "at": "q:approve" }, { "x": 900, "y": 500, "at": "q:queue", "click": true } ],
      "narration": "…" },
    { "id": "s03", "type": "flow", "chapter": "02 · One loop", "loop": true,
      "nodes": [ { "t": "Research", "d": "what is worth saying" }, { "t": "Ideas", "d": "…", "hot": true } ],
      "headline": "One loop, from research to *results.*", "narration": "…" },
    { "id": "s08", "type": "screen", "seam": "arrival", "…": "…" },   // inverse zoom-through INTO this scene (payoff)
    { "id": "s09", "type": "close", "line": "Your job is decisions, not *production.*", "narration": "…" }  // UP cut into the close
  ]
}
```

Rules the builder applies: scene = voice + 0.5 s lead + 1.4 s tail (1.8 s on the close); voice starts at +0.5 s; scenes edge to edge; cut-the-curve LEFT at every seam unless `seam: "arrival"` (inverse zoom-through) or the close (UP). Narration is cached by text hash in `assets/vo/manifest.json`; change the words and only that line is re-synthesised.

## Captures

```bash
node videos/_tools/capture.mjs login                      # once; the owner signs in in the Chrome window
node videos/_tools/capture.mjs shots videos/_captures/shots-d01.json
node videos/_tools/capture.mjs clip  videos/_captures/clip-rail-tour.json
```

Stills are 1920×1080 page screenshots (no browser chrome). Clips are 1920×1080 30 fps MP4. Privacy hides in `frame.md`.
