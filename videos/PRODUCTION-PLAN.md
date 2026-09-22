# MeYouSocial Publisher — video production plan

_Started 2026-09-21. 18 videos: 6 demo (marketing) + 12 training (task walkthroughs) — reduced from 8 + 18 by the owner on 2026-09-21. Owner: Idris Grant._

## Locked decisions

| Decision | Value | Source |
| --- | --- | --- |
| Product shown | **MeYouSocial Publisher** (this repo; live at `sparkweb-production.up.railway.app`) | user, 2026-09-21 — "Velocity" was a slip; Velocity is a sibling app |
| Product name in titles and narration | **Publisher** (the app will be renamed; the UI chrome still says "Publish" until the rename ships — expect that mismatch in captured screens) | user, 2026-09-21 |
| Brand | MeYouSocial — ink `#15181D`, coral `#E5482F`, coral-deep `#B5371F`, coral-soft `#FDE7E1`; IBM Plex Sans + IBM Plex Mono; folded-broadsheet M mark (`public/brand/`) | `src/app/globals.css`, `public/brand/*.svg`, meyousocial.com |
| Narration | Male voice, local Kokoro TTS via `hyperframes tts`. Default **Michael** (`am_michael`); samples for Adam and George in `videos/_samples/` | user: "make narration voice a male" |
| Canvas | 1920×1080, 30 fps, MP4 (H.264) | YouTube / embed / help-center |
| Footage source | Real screens of the **CommunityForce Inc.** workspace (rich data) captured through a Playwright browser the owner logs into once. Demo Workspace is nearly empty and reads badly on video. | inspected 2026-09-21 |
| Framework | HyperFrames (house style: `motion-doctrine`, `cut-the-curve`, `oversized-cursor`, `seam-craft`, `producer-pipeline` geometry) | skills installed |
| Music | None available offline (BGM needs the HeyGen CLI). Demos get a music bed only if a track is supplied or `heygen auth login --oauth` is run. Training videos are voice-only by design. | `resolve.mjs --doctor` |

## Privacy rules for captured screens

- Never capture: the Inbox card **"Invitations not yet accepted"** (contains an email + a token URL), the Keys page with values, People (emails), Notifications, the workspace switcher dropdown open.
- Blur or crop any client email address that appears in a card.
- Article and post text from the CommunityForce workspace is the owner's own company content and may appear.

## The two sets (owner's scope, 2026-09-21: 6 demos + 12 training)

### Demo videos (marketing) — 60–140 s each, value-first, music optional

| # | Slug | Title | Message (the one thing) | Screens |
| --- | --- | --- | --- | --- |
| D1 | `d01-the-loop` | Publisher in two minutes | One loop from research to results, mostly on its own | Inbox, rail tour, each stage |
| D2 | `d02-five-minutes` | Five minutes a day | Your job is decisions, not production; the assistant does the rest, asking first | Inbox cards, Ask dock, proposal, audit log |
| D3 | `d03-idea-to-article` | From idea to published article | Only approved ideas are drafted; every gate is visible | Ideas board, article page, checklist, Publish |
| D4 | `d04-gates` | Gates that review as well as block | Claims are sourced, images are looked at, never an invented number | Review cards, claims, images, Measure dashes |
| D5 | `d05-distribute` | Social on a schedule you set once | Fifteen networks, one connection, wall-clock slots | Distribute, Compose, Calendar, Engage |
| D6 | `d06-control-measure` | Dials and dashboards | Control at the level you want; measured numbers only | Settings → Automation, People, Measure, Reports |

### Training videos — 3–5 min each, task-oriented, voice only, captions

| # | Slug | Title | Covers | Pages |
| --- | --- | --- | --- | --- |
| T01 | `t01-orientation` | Getting oriented | Rail, Inbox, stage strip and badges, Elsie, Help Center, Ask | `/inbox`, `/help` |
| T02 | `t02-setup` | Setting a workspace up | Keys and default model, live-search key, Connections: social, mailbox, website, analytics | `/admin/api-keys` (masked), `/admin/connections` |
| T03 | `t03-brand-topics` | Voice, brand and Topics | Seven Motifs, brand kit, brand context, guardrails, experts; Topics as the spine | `/brand`, `/blog/brand`, `/ideas/topics` |
| T04 | `t04-research-ideas` | Research and the Ideas board | Intel, outliers, competitors, Make it an idea; discover, triage, approve, keywords | `/research`, `/intel`, `/ideas` |
| T05 | `t05-drafts-optimize` | Reading a draft and Optimize | Article page: body, SEO, images, citations, checklist; Optimize findings | `/blog/[id]` |
| T06 | `t06-review` | Clearing the gates | Questions, unsourced claims, held images, held articles, Advance anyway | `/inbox`, `/review` |
| T07 | `t07-publish` | Publishing | Publish day, Publish now, WordPress, Download HTML + Mark as published, calendar | `/publish` |
| T08 | `t08-compose-schedule` | Composing and scheduling social | Compose, per-network overrides, Queue/Schedule/Post now; timezone, slots, calendar, campaigns, evergreen | `/social/compose`, `/setup/schedule`, `/social/calendar` |
| T09 | `t09-approvals-engage` | Approvals and Engage | Approval workflow, queue on approval, Engage, the 24-hour DM window, account health | `/social/approvals`, `/social/engage` |
| T10 | `t10-automation` | The autonomy dials | Function modes, targets, full autonomy, global pause, Run cycle now, social gate | `/setup/automation` |
| T11 | `t11-measure` | Measuring results | Analytics setup, Search, Traffic, Social performance, best time, Reports, Insights | `/admin/analytics`, `/measure/*` |
| T12 | `t12-assistant-team` | The assistant, the team, and troubleshooting | Ask and proposals, roles and People, notifications and digest, workspaces, audit log, "when something looks wrong" | `/assistant`, `/setup/people`, `/notifications` |

## Pipeline (one recipe, 18 times)

```
videos/
  PRODUCTION-PLAN.md          this file
  _kit/                       shared design truth + scene templates + brand assets
    frame.md                  design spec (brand truth for every video)
    assets/                   logos, cursor SVG
    templates/                title.html · screen.html · close.html (reference scenes)
  _tools/
    capture.mjs               Playwright: persistent logged-in profile → PNG stills + MP4 clips from a shot list
    build.mjs                 script.json → TTS → durations → compositions → index.html → ledger → seam stamp
  _captures/                  <shot>.png / <clip>.mp4 (real app footage)
  _samples/                   voice samples
  <slug>/                     one HyperFrames project per video
    BRIEF.md · script.json · SCRIPT.md · STORYBOARD.md · ledger.json
    assets/vo/sNN.wav         narration per scene
    compositions/*.html · index.html
    renders/<slug>.mp4
```

Timing rule (mechanical, from the house recipe): scene duration = voice length + 0.5 s lead + 1.4 s tail (1.8 s on the close); the voice starts 0.5 s into its scene; scenes sit edge to edge; root duration = the sum.

Seams: one film current, cut-the-curve LEFT at ordinary boundaries; one Z-pull into the payoff scene; an UP cut into the close. Ledger written first, seams stamped by script, verified by the seam gate.

Footage: stills as `<img>` in the footage card with cursor-led punch-ins; clips as `<video>` with `data-media-start` windows, audited at 1 fps before use. A screen visible under 3 s is a held still.

Verification per video: `hyperframes lint` → `hyperframes check` → seam gate → contact sheet → render → ffprobe the MP4.

## Order of work

1. Kit: `frame.md`, templates, capture tool, build tool. Prove on **D1**.
2. Owner reviews D1 (voice, look, pacing). Adjust the kit once.
3. Batch demos D2–D6.
4. Batch training T01–T12 (longer; scripts drawn from the owner's guide and Help Center in `docs/MEYOUSOCIAL-PUBLISH-PRODUCT-AND-HELP.md`).

## Status log

- **2026-09-21** — Kit, builder and capture tool written. Owner logged the capture profile in. 16 stills + the rail-tour clip captured from CommunityForce Inc. (Elsie's welcome card auto-dismissed by the tool). **D1 rendered with real screens**: 9 scenes, 139.8 s, `hyperframes check` 0 findings, seam gate PASSED 8/8 → `d01-the-loop/renders/d01-the-loop.mp4`. Awaiting the owner's review of voice, pacing and look before batching D2–D6.

- **2026-09-21 (later)** — Scope cut to 6 + 12. All six demos rendered (D1–D6, 1:55–2:20 each) with real CommunityForce screens and five recorded clips (rail tour, Ask dock, article open, ideas scroll, social tour, settings tour). Training pipeline added: local Whisper word timings (`_tools/words.py`) → verbatim caption rail + callouts landing on the spoken word. **All 18 rendered** (D1–D6 1:55–2:20; T01–T12 2:18–3:38, captioned). Copies of every MP4 in `videos/_deliverables/`. Second pass the same evening: eight more clips recorded (article review, setup tour, brand tour, inbox scroll, publish tour, composer typing, engage tour, measure tour) so **every video carries at least one recorded clip of the app in use**; D4, T02, T03, T06, T07, T08, T09, T11 re-rendered. Privacy: account email masked in every capture; People page captured with member emails and the pending-invitation token hidden; Notifications never used.

- **Publishing kit** in `_deliverables/`: `index.html` (self-contained gallery with player, chapters, search, deep links), `INDEX.md` (readable library page), `index.json` (manifest), `posters/` (one JPG per video at 0:06). MP4s are remuxed with faststart. Regenerate with `node _tools/make-index.mjs && node _tools/make-gallery.mjs`.

## Environment notes (this machine)

- Playwright's bundled Chromium cannot spawn (`spawn UNKNOWN`); `capture.mjs` uses the installed Google Chrome (`channel: "chrome"`). Launching any GUI browser from Claude's shell needs the sandbox off.
- IBM Plex is not in the renderer's bundled font set; `_kit/assets/fonts/fonts.css` embeds the latin woff2 files (`_tools/fetch-fonts.mjs` regenerates them) and the builder inlines it into every scene.
- Seam gate recipe: `npx hyperframes preview --no-open --port=<p>` detaches on its own; then `CHROME_PATH=<hyperframes chrome-headless-shell> node ~/.claude/skills/motion-doctrine/scripts/seam-gate.mjs verify --ledger ledger.json --url http://localhost:<p>` with the shell sandbox off (localhost is unreachable from the sandbox), then `preview --stop`.
- Kokoro TTS text must go through `--text-file`; a quoted sentence on the command line is split at spaces under `shell: true`.

## Known soft spots to review

- Kokoro pronunciation: acronyms are spelled out in `spoken` fields (S E O, G A 4, H T M L); listen for any others.
- Punch-in targets were placed from full-frame captures by eye; a few may frame a neighbouring panel rather than the exact control.
- Captions are Whisper's transcription of the narration, so casing and punctuation occasionally differ from the script.
- Contrast checker flagged two seam frames (T03, T12) where the outgoing scene is mid-fade; no held frame is affected.
- Clips play at 0.7–0.85× where a recording was shorter than its scene.

## Open items the owner holds

- Log in once in the Playwright window when asked (the capture profile is `videos/_tools/.profile`, git-ignored).
- Pick the voice: Michael (default), Adam, or George — `videos/_samples/*.wav`.
- Optional music bed for demos: supply a track, or install the HeyGen CLI and run `heygen auth login --oauth`.
- The "Publisher" rename in the app itself is a separate code change (`src/lib/product.ts`); not part of this plan.
