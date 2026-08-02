@AGENTS.md

# Project state — handoff for a fresh session

_Last updated: 2026-08-02._

**MeYouSocial** is a multi-tenant AI content engine: it turns research into content, publishes
it, and measures what happened — for several companies on one install. (It began as CreateUp, a
YouTube research/scripting tool, and absorbed Spark's blog/SEO pipeline. Older docs and some
code comments still say "CreateUp"; the product is MeYouSocial.)

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, Prisma 6 + PostgreSQL,
Auth.js v5 (JWT). Hosted on **Railway**; `prisma migrate deploy` runs on boot.

**Full detail lives in `docs/MEYOUSOCIAL-PLAN.md`.** Read that before a big change.

## ⚠ Two repos — every push goes to BOTH

```bash
git push origin main; git push deploy main:main
```

`origin` = `igrant9679/MeYouSocial` (canonical). `deploy` = `sgrant5724/spark`, which is what
Railway actually builds from. Push only to `origin` and nothing deploys. The usernames are
embedded in the remote URLs on purpose — Git Credential Manager juggles two accounts and drops
403s without them.

## How to work here
- Read `AGENTS.md` (above): this is Next.js 16 — check `node_modules/next/dist/docs/` before
  writing framework code; don't trust training-data assumptions.
- **Windows machine.** Node is at `C:\Program Files\nodejs`. In PowerShell, `npx`/`node` may not
  be on PATH — prefix with `$env:Path = "C:\Program Files\nodejs;" + $env:Path` or call
  `node node_modules\typescript\bin\tsc --noEmit` directly. `python`/`python3` and `uv`/`uvx`
  are installed (real Python 3.12.10).
- Before committing: `tsc --noEmit` clean, then `npm run build`. Commit + push only when asked.
- **Never write migration SQL with PowerShell `Out-File`/`>`** — Windows PowerShell 5.1 emits a
  UTF-8 BOM and Postgres fails the migration with `syntax error at or near "﻿"` (cost a failed
  deploy on 2026-07-22; recovery is `prisma migrate resolve --rolled-back <name>` against
  `DATABASE_PUBLIC_URL` of the `Postgres-Qsxl` service, then redeploy). Use
  `[System.IO.File]::WriteAllText(path, $sql, (New-Object System.Text.UTF8Encoding $false))`.
- **Commit messages with quotes need `git commit -F <file>`** — a PowerShell 5.1 here-string
  (`@'…'@`) passed to `git commit -m` breaks on double quotes in the body and git reads the
  remainder as a pathspec. Write the message to a scratch file and use `-F`.
- Throwaway probes go in `scripts/_tmp-*.mts`, run with `npx tsx`, and are **deleted after** —
  they otherwise fail `tsc --noEmit` on the next run.
- No billing/credits/payments anywhere in the app (per spec). Access = roles + optional soft limits.

## ⚠ NEVER TRUST `models.list()` ON THE GOOGLE KEY — probe first

Three separate model ids have been advertised by the API and then 404'd when called:

| Advertised | Reality |
| --- | --- |
| `gemini-2.5-pro` / `gemini-2.5-flash` | 404 "no longer available to new users" |
| `imagen-4.0-generate-001` (+ `-ultra`, `-fast`) | 404 "no longer available to new users" |
| `gemini-3.1-flash` | 404 "not found for generateContent" |

`MODEL_MAP` in `src/lib/llm/google.ts` routes every gemini id to the `-latest` aliases for this
reason. **Probe a model against the live key before shipping it.** Known-good today:
`gemini-flash-latest` / `gemini-pro-latest` (text + vision), `gemini-3.1-flash-image`
(image output via `generateContent`), `gpt-image-1` (OpenAI images), `gpt-4o-mini` (OpenAI vision).

## ⚠ Mock fallbacks are the #1 source of confusion

Several subsystems degrade to a mock rather than failing. That keeps the app usable without keys,
but it means **bad output can look like real output**. Rules learned the hard way:

- **Default every `USE_MOCK_*` flag to FALSE**, so a key pasted in the admin UI activates the real
  provider with no redeploy. `USE_MOCK_YOUTUBE` and `USE_MOCK_IMAGES` both once defaulted true and
  silently beat a working paid key.
- **A mock must be nameable.** `ImageGenResult.provider` / `VideoRenderResult.provider` carry the
  provider name so the UI can say "this is a placeholder" — and stop saying it once it isn't.
- **Never invent a number.** A blank is not a zero: `value: null` renders as a dash with a reason.
  Outlier ratios are measured or absent. Three separate PRNG-derived "outlier" figures have been
  found and removed.

## Architecture quick map
- **LLM router** `src/lib/llm/` — provider-agnostic `llm.complete()/stream()`. Real providers
  (anthropic, google) are wrapped with a 45s timeout + transparent **fallback to mock** on any
  error. Keys resolved by `src/lib/llm/keys.ts`. ⚠ OpenAI is NOT wired as a text provider — it's
  used for images and vision only.
  ⚠ **`LLMResponse.provider` is stamped by the ROUTER, not the provider** — the fallback is the
  whole point, so the provider you *asked* for is not evidence of who replied, and mock prose is
  fluent. Any surface putting generated text in front of a person must check it. ⚠ A small
  `maxTokens` returns **empty** text from `gemini-2.5-pro`: it is a reasoning model and spends the
  budget before emitting anything — don't cap a probe and conclude the provider is broken.
- **Settings / multi-tenancy** `src/lib/settings.ts` — resolution is **`WorkspaceSetting` → global
  `Setting` → env var** (30s cache). Each company brings its own keys; a platform row back-fills
  every workspace, which is usually not what you want. ⚠ **`PLATFORM_MANAGED_KEYS` is the deliberate
  exception** — those skip the workspace layer on read and only `isPlatformOperator` can write them,
  so one shared credential serves every tenant and no stale per-workspace row can shadow it.
  `api_key:youtube` is the only member: the **Data** API key takes the channel as an argument and
  reads public data, so it isn't channel-bound. ⚠ Quota is per **Cloud project**, so sharing pools
  it — one tenant can exhaust another. Never add `youtube_oauth:*` here; that half IS per-channel.
- **Images** `src/lib/images/` — `gpt-image-1` (hand-written REST) or `gemini-3.1-flash-image`
  (via `@google/genai`), chosen by `image:provider` (`auto|mock|openai|google`). Bytes are written
  into StorageProvider so URLs are ours and permanent; dimensions are parsed from the bytes, not
  echoed from the request. A selected real provider that fails **throws** rather than substituting
  a placeholder.
- **Vision** `src/lib/vision.ts` — `fetchReferenceImage()` (YouTube link → `i.ytimg.com`, direct
  image URLs, else null) + `describeImageStyle()`. Used by Thumbnail Studio's Clone so it actually
  looks at the reference instead of guessing from the URL string.
- **Video** `src/lib/video/` — Google Veo, `video:provider` (`auto|mock|veo`). The provider returns
  a **bare** Gemini Files URI (never key-appended — that would leak the key through the UI and DB)
  which expires in ~2 days and isn't publicly readable, so `persistRenderOutput` re-fetches it with
  an `x-goog-api-key` header and writes the bytes into StorageProvider; `VideoRender.storedUrl` is
  the durable copy the UI prefers. ⚠ Persistence is **code-verified only — no real render has ever
  run**, and a failed persist leaves `storedUrl` null on purpose so the UI warns about expiry.
- **Social** `src/lib/zernio/` + `src/lib/social/` — Zernio publishes to 15 networks; one post fans
  out to N `SocialPostTarget`s, each with independent status. Slots are **wall clock** (weekday +
  minute) so 09:00 survives DST; only `social/slots.ts` converts.
- **Email** `src/lib/unipile/` — ⚠ **Railway blocks outbound SMTP** (587/465/2525 all ETIMEDOUT),
  so a connected mailbox over HTTPS is the only way real mail leaves this host. `src/lib/email/`
  still holds the nodemailer path for installs that can use it. Don't delete unipile.
- **Storage** `src/lib/storage/` — local or Google Drive (`storage:backend`). Drive OAuth scope is
  `drive.file` and must stay (non-sensitive, no Google verification). Served by session-gated
  routes `/uploads/<key>` and `/api/files/<key>` — nothing is public.
- **Motif tone engine** `src/lib/motifs.ts` — the 7 Motifs are versioned DB rows per workspace, not
  hard-coded prompt text. `motifPromptFor()` renders a post's weighted blend. Every new generation
  surface should inject it plus `brandGuardrailBlock()`. Admin UI: `/blog/brand`.
- **Public URL** `src/lib/public-url.ts` — derives the origin from the request host, so **custom
  domains need no env changes**. Auth.js has `trustHost: true`.
- **Hover help** `src/components/HelpTip.tsx` + `src/lib/help-tips.ts` — pure CSS (`group-hover` /
  `group-focus-within`), so it drops into server components with no JS. ⚠ `type="button"` is
  load-bearing (these sit in forms); never nest one in a `<label>` or `<a>`; and inside an
  `overflow-x-auto` strip use a native `title` instead, because overflow clips the bubble.
- **Background jobs** `src/lib/jobs/` — **durable Postgres queue** (`Job` table). Jobs survive a
  redeploy: the worker in `instrumentation.ts` requeues rows left `running` with a stale `claimedAt`
  (a killed container), and `progress()` doubles as the heartbeat that keeps a long job from being
  requeued underneath itself. Claiming is `UPDATE … WHERE state='queued'`, so multi-replica sweeping
  is safe. ⚠ Handlers register as a side effect of importing an action module, so the worker calls
  `registerAllJobs()` explicitly — without it a claimed row finds no handler. ⚠ `JOB_BACKEND=redis`
  is an obsolete alias for `db`: **no Redis queue ever existed**, yet it was set in production and
  read by nothing, so every redeploy silently destroyed queued and running jobs. Redis is for the
  sweep *locks* only.
- **AI assist** `src/lib/assist/fields.ts` (registry) · `src/app/actions/assist.ts` · `src/components/AiAssist.tsx`
  — draft buttons on description fields. The client sends a field **key**, never a prompt, so a
  browser can't spend the workspace's LLM budget on arbitrary instructions. It **proposes** (Use it /
  Discard / Try again) and never overwrites until accepted. ⚠ Accepting assigns through the
  **prototype's value setter** — React's `_valueTracker` swallows an input event it thinks is
  unchanged, so `el.value = …` leaves a *controlled* field's state stale and the next keystroke
  reverts it. ⚠ Model resolution is `channel → workspace → env`, then `resolveUsableModel()`; skipping
  the workspace tier sent a fully-configured workspace to a provider it had no key for and silently
  to the mock. ⚠ It **refuses** rather than drafting from nothing (the company name is not grounding —
  that produced "LSI Media is a company."). Fields that must stay unassisted: expert intake answers,
  voice training samples, and anything that is a list.
- **Key format validation** `src/lib/key-format.ts` — refuses a URL, whitespace, an email or a value
  under 20 chars at save time, plus a wrong prefix where the vendor's format is stable (`sk-ant-`,
  `sk-`, `xai-`, `sk_`, `tvly-`). ⚠ **Google is deliberately exempt**: Gemini keys are documented as
  `AIza`, and the key in live use starts `AQ.` — a real key a strict check would have refused. The
  admin page also flags a *stored* value that fails, since save-time checks can't see old mistakes.
- **Content-size zoom** `src/lib/ui-size.ts` — `zoom` on `<body>` (1 / 1.1 / 1.22). ⚠ Always set
  `--ui-zoom` alongside it: `.min-h-screen` is overridden (unlayered) to `calc(100vh / var(--ui-zoom))`
  so viewport-sized boxes stay one viewport after scaling. Standard size is a genuine no-op.
- **Left nav** `src/components/LeftRailNav.tsx` — active route via shared `isNavActive()`.
- **Theming** `src/app/globals.css` — light/dark via `data-theme`. Per-hue tokens `--<hue>`,
  `--<hue>-soft`, `--<hue>-on`; dark mode derives soft/on via `color-mix`, so **use the tokens, not
  raw hex**. ⚠ `.btn` / `.card` are **unlayered** and beat Tailwind utilities — a bare `hidden` on a
  `.btn` does nothing; use `!`-marked utilities.
- **Shared UI** `SubmitButton`, `MobileNav`, `ChannelSwitcher`, `ValidatedInput`, `DeleteButton`
  (one registry in `src/lib/deletable.ts`, one action, 15 kinds — don't add bespoke delete actions).

## Admin surfaces (sidebar → Admin)
Users · Workspace · Soft limits · Usage · Channels · **API keys** (`/admin/api-keys`: LLM, search,
images, video, TTS, storage) · **Connections** (`/admin/connections`: social via Zernio, mailboxes
via Unipile) · **Analytics** (`/admin/analytics`) · **Email** (`/admin/email`). All configurable
in-app without touching Railway.

## Open items / things the user still owns
- **Analytics is credential-blocked.** Neither the Search Console API nor the Google Analytics
  Admin API has ever been enabled on Cloud project `479503233109`; the service account is not
  short of permission. It needs the owner's Google account. ⚠ A disabled API and a missing grant
  both return 403 `PERMISSION_DENIED` — `explainGoogleError` separates them, don't collapse that
  back to a `/403/` test. YouTube OAuth is separate and needs a consent flow.
- **Veo persistence has never run for real.** The code landed in `74115ee` and every claim about it
  is code-verified only: `VideoRender` is 0 rows, and the Files endpoint refuses anything but a
  generated file ("Only GENERATED files can be downloaded"), so an uploaded probe can't stand in.
  The first paid render proves it — and now logs the reason if it fails.
- **Rotate `AUTH_SECRET`** — a `.test-cookies.txt` with an encrypted session token was once
  committed then removed (`8daa5b7`). Not exploitable without the secret; rotating signs everyone
  out once.
- **Custom domain:** if one is added in Railway → Settings → Networking, add the Google OAuth
  redirect URI in Cloud Console if SSO is enabled. No code/env change otherwise.
- **A workspace has a URL stored as its ElevenLabs key**, with `tts:provider` pointed at it, so
  voiceover there fails at call time. Flagged in red on `/admin/api-keys`. Only the owner can fix
  it — never guess a credential.
- ~~The assist + platform-key UI has only been driven as the platform operator.~~ **Verified
  2026-08-02** with a throwaway fixture user (ADMIN of Demo Workspace only, deleted after): the
  YouTube card renders read-only for a tenant admin (badge + tenant copy, no input/Save), the
  Storage section is operator-only as intended, and assist propose/discard works for a
  non-operator. ⚠ In passing this confirmed the Demo env back-fill is live for assist:
  workspace-level fields have no channel, so Demo resolves env `claude-sonnet` → the platform
  `ANTHROPIC_API_KEY` and gets **real** (unlabelled, correctly) Claude output on the platform's
  key. Known and deliberate — raise it, don't silently "fix" it.
- **A reported layout problem is unexplained.** The content-size `zoom` was *ruled out* by
  measurement on prod (no overflow at 1.22, with or without the zoom fix; modern Chrome handles
  standardised `zoom` correctly). Ask which page and whether a reload clears it before changing
  layout CSS — the evidence points at a partially-repainted window, not a CSS bug.

## Machine-level (not part of this repo)
User-level Claude skills are installed at `C:\Users\Admin\.claude\skills\`: `notebooklm-research`,
`watch`, and the ui-ux suite (`ui-ux-pro-max`, `banner-design`, `brand`, `design`,
`design-system`, `slides`, `ui-styling`). The `notebooklm` MCP server is registered at user scope;
it needs a one-time `uvx notebooklm login` (Google sign-in) the user must do.
