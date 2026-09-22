# QA pass — MeYouSocial Publisher video library

_Full pass run 2026-09-22 over all 18 rendered videos (6 demo + 12 training, 49 minutes)._

Method: per-scene contact sheets of every scene of every video (54 frames per video, 3 per scene);
a word-level diff of every narration track against its script using local Whisper; a frame-level
scan of all 18 files for exposed account data; container, loudness, black-frame and silence probes;
and a clip-window audit against the length of every source recording.

## Defects found and fixed

### 1. A personal email address was visible in 17 of the 18 videos — P0
The app header shows the signed-in account. `capture.mjs` applied its privacy masks **once**, before
the scripted actions ran, so every page a clip navigated to came back unmasked — and the recording
was already running before the first mask was applied. Still screenshots were unaffected (they
re-apply masks after actions); only the 14 recorded clips leaked.

`idris.grant@gmail.com` was legible in the page header for roughly 1–22 seconds per video, in every
video except D1, totalling about two minutes of footage across the set.

Fixed two ways:
- The exposed region was painted out in all 14 source clips (`_captures/*.mp4`); originals are kept
  outside the repo. Darkest pixel in the region went from 118 to 231, i.e. no glyphs remain.
- `capture.mjs` now installs masking **inside the page**: a MutationObserver re-hides after
  client-side navigation, `addInitScript` re-arms it after a full load, masking is armed before the
  first recorded frame, and an always-on `email:auto` rule hides any text matching an email pattern.

Also checked and found already safe: the Members list (names only, addresses masked), the API keys
page (values masked), pending invitations and invite tokens (hidden).

### 2. 110 caption errors across the 12 training videos — P0
Burned-in captions were built from raw Whisper output, so every transcription error was rendered on
screen. Worst cases: the brand read **"Welcome to me, you social publisher"** in T01 and
**"Me, you social publisher."** as the closing caption of T12; two cues showed hallucinated text
("all coronavirus Ob culminating", "tackled submitted records properly you"); "GA4" appeared as
"G of 4", "API" as "a PI", "AI" as "an I"; plus homophones ("brake"→"break", "queue"→"q",
"week"→"weak") and 15 split hyphens ("in -app", "24 -hour").

Fixed in `build.mjs`: captions now take their **text from the script** and only their **timing** from
Whisper, matched by longest-common-subsequence alignment with interpolation across unmatched words.
558 cues rebuilt; zero artifacts remain.

### 3. Six scenes mispronounced GA4, API and AI — P1
The voice reads a standalone letter "A" as a schwa. Verified by direct synthesis probes: "A I"
came out as *"the eye assistant"* with the A dropped entirely, and "G A 4" as *"G of four"*.
Affected D2 s06, T02 s05, T11 s02 and s03, T12 s03 and s06. Rewritten as `GA4`, `API`, `AI`
(unspaced forms synthesise correctly) and re-voiced; one line was rephrased where the article
"an" still merged into the acronym. All six verified correct on the new audio.

### 4. T04 froze on a dead clip for 5.4 seconds — P1
`ideas-scroll.mp4` is 15.8s; T04 scene 5 asked for 21.1s of it, so the last quarter of the scene
held a frozen frame. T01 scene 2 overran `rail-tour.mp4` by 0.4s. Playback rates corrected
(0.70→0.51 and 0.80→0.77). A full audit of all 20 clip uses found no other overrun.

### 5. Two scenes showed the wrong page; one showed a loading skeleton — P2
D6 and T10 scene 2 narrate the function-mode dials, but their clip ran past the Automation page and
ended on an empty Measure page. Rates lowered so both stay on Settings pages. T11 scene 4 showed a
0.7-second grey loading skeleton mid-scene; those frames were cut from `measure-tour.mp4`.

## Checked and found sound
- **Container and encode**: all 18 are 1920×1080, 30 fps, H.264 + 48 kHz AAC, faststart.
- **Audio levels**: −20.9 to −22.4 LUFS integrated, peaks −1.1 to −3.1 dBFS. No clipping, no video
  noticeably louder than another.
- **No black frames** over 0.5s and **no silences** over 4s anywhere in the set.
- **Every scene inspected** on contact sheets: no blank footage cards, no broken layout, no clipped
  headlines, callouts and chips land correctly, titles and closes render as designed.
- **Every video contains at least one recorded clip** of the app in use.

## Known and accepted
- **App chrome still reads "Publish"**. Screens were captured before the in-app rename; narration,
  graphics and lockups all say "Publisher". Re-capturing would fix it but would also replace every
  screenshot in the library.
- **Thin data on some screens** (Approvals, Calendar, Measure) is the real state of the demo
  workspace, and in Measure's case it is the point being made.
- **Third-party YouTube thumbnails** appear on the Research and Intel screens in D4 and T04. They are
  public data the product legitimately displays; worth a look before wide distribution.
- **A Google OAuth client ID** is visible on the analytics setup screen in T02 and T11. Client IDs
  are public by design and the client secret is masked, but it does identify the Cloud project.
- **D1's close** holds the lockup alone for about five seconds before its closing line, because that
  video's narration says the brand name first. Deliberate, and different from the other seventeen.

## Verification after the fixes

All 18 videos were rebuilt and re-rendered, then re-checked:

| Check | Result |
| --- | --- |
| Account address visible anywhere | none — every clip-scene exposure gone, verified frame by frame |
| Caption artifacts | 0 across 558 cues; text confirmed in the rendered pixels |
| Acronym pronunciation | GA4, API and AI correct in all six scenes, confirmed on the new audio |
| Clip overruns | none across all 20 clip uses |
| `hyperframes check` | passes on 18/18 (two contrast warnings are mid-seam frames where the whole layer is at 35% opacity during the 0.42s entry) |
| Seam gate | 18/18 passed, 0 fail 0 warn across 117 seams |
| Format | 18/18 at 1920×1080, 30 fps, H.264 + AAC, faststart |
| Loudness | −20.9 to −22.4 LUFS, peaks −1.1 to −3.0 dBFS |
| Black frames / long silences | none |

Total running time 47:40. The publishing kit (`INDEX.md`, `index.json`, `index.html`, `posters/`)
was regenerated against the new files.

_Note on the seam gate: `hyperframes preview` detaches, so running the gate across many projects in
one loop leaves servers holding ports and later projects get probed against a stale page — which
reports every check failing at every seam. Kill listeners between runs._
