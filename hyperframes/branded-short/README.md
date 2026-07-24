# Branded short — HyperFrames composition

A portrait (1080×1920) short-form title card, rendered on HeyGen's HyperFrames
cloud. One template, themed per workspace from its `BrandKit`.

The app never runs Chrome or ffmpeg for this: `src/lib/branded-video/` bundles
this directory into a STORED zip, base64-submits it to
`POST /v3/hyperframes/renders` with a variables JSON built from the workspace's
`BrandKit`, polls, and stores the finished MP4 through the app's storage layer.

## Variables (declared on the `<html>` root)

Injected at render time via HeyGen's `variables` field; defaults are the app's
own brand tokens so it renders on-brand with nothing configured.

| id | source in the app |
| --- | --- |
| `title` | the post/idea title |
| `eyebrow` | content-type / Topic label |
| `brandName` | workspace name |
| `footer` | `BrandKit.footerCredit` |
| `primaryColor` / `secondaryColor` / `accentColor` | `BrandKit.*Color` |
| `textColor` | AA-contrast foreground picked for `primaryColor` |

## Editing

`cd` here and use the HyperFrames CLI to iterate:

```bash
npx hyperframes preview      # live studio
npx hyperframes check        # lint + runtime + WCAG contrast
npx hyperframes render       # local MP4 (needs Chrome + ffmpeg)
```

Keep it deterministic: no `Date.now()`, `Math.random()`, or network fetches in
composition scripts (the Google Fonts link is resolved at compile time). Every
timed element needs `class="clip"` + `data-start`/`data-duration`/
`data-track-index`, and the GSAP timeline stays paused and registered on
`window.__timelines["main"]`.
