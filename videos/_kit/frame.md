# frame.md — MeYouSocial Publisher video design spec

Brand truth for every video in `videos/`. Strict: hex values, font families, weight relationships, the Do/Don't list. Adapt for video: sizes, spacing, opacity, border weight (see `hyperframes-creative/references/video-composition.md`).

## Identity

- **Family:** MeYouSocial. **Product:** Publisher (say "MeYouSocial Publisher" once per video, then "Publisher").
- **Mark:** the folded-broadsheet M — ink badge, white left fold, coral right fold. Product chip: white disc with a coral "out into the world" arrow. Files in `assets/`.
- **Tagline:** "One loop from research to results." Long form: "Your job is decisions, not production."
- **Tone:** professional and plain-spoken, practitioner to practitioner. No hype words. Short sentences. The product's own vocabulary (Inbox, gates, held, sweep, publish day, slots, Topics).

## Palette (light canvas — the app is light; make light cinematic)

| Token | Hex | Use |
| --- | --- | --- |
| `--canvas` | `#FBF7F5` | stage ground (warm off-white, tinted toward coral) |
| `--canvas-deep` | `#15181D` | ink stage for title/close and the "dark chapter" cards |
| `--ink` | `#15181D` | headlines, body |
| `--ink-2` | `#4A4F58` | secondary text, labels |
| `--coral` | `#E5482F` | the one accent: last word of headlines, callout values, cursor tap ring, progress |
| `--coral-deep` | `#B5371F` | accent on light for AA contrast in small text |
| `--coral-soft` | `#FDE7E1` | chips, soft fills, glow |
| `--line` | `rgba(21,24,29,.18)` | card borders (2 px) |
| `--white` | `#FFFFFF` | footage card fill |

Rules: one accent hue. No gradient text. No left-edge accent stripes. No cyan/purple. Never pure `#000`; ink is `#15181D`.

## Type

- **Headline:** IBM Plex Sans 700, 72–96 px, tracking −0.02em, last word or phrase in coral.
- **Body / callout titles:** IBM Plex Sans 500–600, 28–34 px.
- **Eyebrow / labels / counters:** IBM Plex Mono 600, 20–24 px, uppercase, letter-spacing .16em, `--ink-2` or coral.
- Both families are bundled by HyperFrames — no `@font-face` needed. Never a third face.

## Scene geometry (1920×1080)

- **Footage card:** `left 80 top 110 width 1320 height 742`, radius 18, 2 px `--line`, shadow `0 30px 80px rgba(21,24,29,.18)`, white fill. Inside: `.zo` (transform-origin 50% 50%) › `.zi` › the still or clip at `1320×742` (a 1920×1080 capture scaled 0.6875 — no browser chrome to crop; captures are page screenshots). Punch-ins: scale on `.zo`, counter-translate on `.zi`, same duration and ease; card-space offset = frame coords × 0.6875 − (660, 371); translate = −offset.
- **Story column:** `left 1460 width 380`, chapter eyebrow at `top 110`, callouts stacked from `top 170`, gap 22. Callouts are content-sized cards (white, 2 px line, radius 14, padding 22/26) or chips — never one tall panel, never bare mono text. Values 56–96 px / 700; titles 30 px / 600; chips 21 px / 600.
- **Headline band:** `left 80 top 890 width 1400`, 72 px / 700, waterfall entry from below.
- **Title / close scenes:** ink canvas `--canvas-deep`, centred lockup, headline in white with coral last word, eyebrow in mono. Close puts the lockup on the ink canvas with the tagline; end card holds ≥ 1.8 s.
- **Cursor:** house oversized macOS arrow, `5cqw` inside the footage card, white body + ink stroke, enters from below the card, tip-targets, click taps `0.84 → 1`.
- **Background layer (every scene):** opaque canvas + one radial coral glow at 22 % opacity drifting once across the scene (`ease: none`) + a faint 96 px grid at 6 %. No breathing loops.

## Motion

- Film current: LEFT. Cut-the-curve at every ordinary seam. Reserved: one inverse zoom-through into the payoff scene; one UP cut into the close.
- Entries ≤ 0.8 s, `power4.out` / `expo.out`; exits ≈ 75 % of entries. No `bounce`, no `elastic`.
- Every callout lands on its spoken beat (word position ÷ 2.8 words/s inside the line, or real word timings when transcribed).
- Sustained-motion route per scene named in the storyboard: staged reveals (default), camera with intent (punch-ins), cursor-led action, sequenced UI life (a badge count ticking, a card moving column).

## Captions (training videos)

Lower third, IBM Plex Sans 600 34 px, ink on a white 92 % plate, radius 10, centred at `bottom 48`, max 2 lines / 42 chars. Verbatim rail, never embedded. Demos: no captions unless asked.

## Do / Don't

- Do show real screens. Do keep the app's own words on screen (a callout quotes the UI).
- Don't invent numbers — every figure on screen is the exact string in the footage.
- Don't show emails, invitation tokens, key values, or the open workspace dropdown.
- Don't call the app "Publish" in narration or titles; say "Publisher".
