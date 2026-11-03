@AGENTS.md

# Project state — handoff for a fresh session

_Last updated: 2026-10-27._

**MeYouSocial Publisher** (the product, renamed from Publish on 2026-09-22 — since 2026-09-09 **MeYouSocial** is the family brand for this app and its siblings; names live in `src/lib/product.ts`) is a multi-tenant AI content engine: it turns research into content, publishes
it, and measures what happened — for several companies on one install. (It began as CreateUp, a
YouTube research/scripting tool, and absorbed Spark's blog/SEO pipeline. Older docs and some
code comments still say "CreateUp"; the product is MeYouSocial Publisher.)

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, Prisma 6 + PostgreSQL,
Auth.js v5 (JWT). Hosted on **Railway**; `prisma migrate deploy` runs on boot.

**Full detail lives in `docs/MEYOUSOCIAL-PLAN.md`.** Read that before a big change.

**Current work: the audit plan** `docs/AUDIT-2026-10-25.md` (local, untracked) — its Progress
section says what has shipped and what is next; the verify-before-push recipe is
`.claude/skills/meyousocial` §7. Shipped rules are indexed below and spelled out in
`docs/INVARIANTS.md`.

⚠ **Resuming costs context — read narrowly.** To pick up where the last session left off, read
**only the newest two or three dated entries at the top of §3 (`## 3. NEXT`)** of
`MEYOUSOCIAL-NEXT-SESSION.local.md`; they are newest-first and the current one is usually
10–15 lines. Do **not** read that file whole: it is ~3,650 lines (~68K tokens) and **holds live
credentials** (Railway token, DB connection string, `TOKEN_ENCRYPTION_KEY`, Zernio webhook
secret), which do not belong in a context window. Same for `docs/AUDIT-2026-10-25.md` (~41K
tokens) — read its Progress section, not the file. Go deeper only when the task actually needs it.

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
| `veo-3.0-generate-001` (the documented id) | 404 "not supported for predictLongRunning" (found 2026-08-03, cost a failed render row + a failure email) |

`MODEL_MAP` in `src/lib/llm/google.ts` routes every gemini id to the `-latest` aliases for this
reason. **Probe a model against the live key before shipping it.** Known-good today:
`gemini-flash-latest` / `gemini-pro-latest` (text + vision), `gemini-3.1-flash-image`
(image output via `generateContent`), `gpt-image-1` (OpenAI images), `gpt-4o-mini` (OpenAI vision),
`veo-3.1-fast-generate-preview` (video — proven by the first real render 2026-08-03; the key lists
only `veo-3.1-*-preview` for `predictLongRunning`).

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
  minute) so 09:00 survives DST; only `social/slots.ts` converts. Since 2026-08-04 also:
  **Campaigns** (named series, own utm_campaign at send), **slot categories** (one matching rule,
  `pickFreeSlot` — own category → general → any, so nothing strands), **evergreen recycling**
  (`social/evergreen.ts`: clones a posted source into free slots after its cooldown; OPT-IN via
  `social:evergreen_fill`, clones carry `recycledFromId` and are never themselves evergreen), an
  **approval workflow** (`social:require_approval`: pending/changes posts can't be sent, scheduled,
  queued or dragged — enforced in publish + the sweep's claim, not just the UI; ⚠ the sweep's
  filter is `OR [null, "approved"]`, never `notIn` — SQL NOT IN drops NULL rows and would silently
  stop every normal post), and **CSV import** (`actions/social-workflow.ts`).
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

## Admin surfaces (Settings → the admin tabs; there is no "Publish Admin" any more)
⚠ **2026-09-20 (audit B1.4): the operator pages kept every `/admin/*` URL and lost their own
nav.** `AdminSubNav` is deleted, `stageFor()` maps `/admin/*` to `/setup`, and the StageStrip
renders them as Settings tabs — gated by an `admin` / `operator` flag decided on the server in
`app/(app)/layout.tsx`. That flag is COSMETIC: `admin/layout.tsx` still does
`requireRole("ADMIN")`, `/admin/workspaces` keeps its own operator check, and the
platform-key gating stays in `actions/api-keys.ts`. `/admin` itself redirects to `/setup/people`.
Don't move the page files — roughly thirty actions `redirect()` to `/admin/*` URLs.

Tabs: **Keys** (`/admin/api-keys`: LLM, search, images, video, TTS, storage) · **Analytics**
(`/admin/analytics`) · **Email** (`/admin/email`) · **Workspace** (`/admin/settings`) · **Usage**
(`/admin/usage`, with `/admin/limits` riding it). Not tabs, reached from the pages that own them:
`/admin/connections` (from Settings → Connections), `/admin/channels` (Channels rail entry),
`/admin/workspaces` (operator only). All configurable in-app without touching Railway.

## ⚠ Invariants — read `docs/INVARIANTS.md` before changing these areas

These are rules already shipped and verified; breaking one is a regression. The full text
of each lives in `docs/INVARIANTS.md` — read the relevant section before touching that
area, rather than loading all of them into every session.

- Nav invariants after the 2026-09-20 UX audit
- Topics are the spine — 2026-09-21 — design doc "Topics as the spine"
- Socialmonials parity — 2026-10-17 — the team's white-label posting tool, brought in
- Security invariants — 2026-10-25, audit Phase 0 — `docs/AUDIT-2026-10-25.md`
- One actor at a time — 2026-10-26, audit Phase 1, first part
- Times, mail and the engine's failures — 2026-10-27, audit Phase 2, first part
- What reaches people is real, and nobody's edit is undone — 2026-10-27, audit Phase 2, second part
- One set of network rules; the queue keeps its places — 2026-10-27, audit Phase 2, social group
- Every link goes somewhere this person can open — 2026-10-27, audit Phase 2, shell and assistant group
- Ideas get made, and Intel's numbers are real and dated — 2026-10-27, audit Phase 2, ideas group
- Models that can write, limits that hold, keys that stay — 2026-10-28, audit Phase 2, settings group
- The studio writes only what a model wrote, and stops when told — 2026-10-28, audit Phase 2, video studio group
- Reports say only what was measured; a refusing provider is named — 2026-10-28, audit Phase 3, part 1
- Windows end where the data does; rates have honest bases — 2026-10-28, audit Phase 3, part 2a
- The audit, Topics and recommendations tell the truth about time — 2026-10-28, audit Phase 3, part 2b
- Shell copy says what was checked — 2026-10-28, audit Phase 3, part 3a
- Help, dates, outliers and the assistant stay current — 2026-10-28, audit Phase 3, parts 3b and 4
- Speed: no server code in the browser, quiet pollers, warm pages — 2026-10-28, audit Phase 4, part a
- Heavy pages: Engage keeps its lists, the board drops its panels — 2026-10-28, audit Phase 4, part b
- Lint is clean — keep it so — 2026-10-28, audit Phase 4, part c
- The engine checks in; buttons say what happened — 2026-10-28, audit Phase 5, wave 1, part a
- Outliers show their base; Research rows and the header are quieter — 2026-10-28, audit Phase 5, wave 1, part b
- One date style; the sync names what it couldn't match — 2026-10-28, audit Phase 5, wave 1, part c
- Connecting checks it's the right site — 2026-10-28, audit Phase 5, wave 1, part d
- The kill switch is visible; the board can be searched — 2026-10-28, audit Phase 5, wave 2, part a
- Triage many at once; approvals scale and talk — 2026-10-28, audit Phase 5, wave 2, part b
- The queue can be rearranged; the calendar shows everything — 2026-10-28, audit Phase 5, wave 2, part c
- One range for Measure; one shell poll; links are checked at build — 2026-10-28, audit Phase 5, wave 2, part d
- The Inbox can be snoozed and shared out — 2026-10-28, audit Phase 5, wave 2, part e1
- The assistant's proposals are cards with a bound Yes — 2026-10-28, audit Phase 5, wave 2, part e2
- Articles have a real publishing calendar — 2026-10-28, audit Phase 5, wave 2, part e3
- Who did what is visible; admins hear about security changes — 2026-10-28, audit Phase 5, security part 1
- Rate limits and security headers — 2026-10-29, audit Phase 5, security part 2
- API tokens, key history, idle members — 2026-10-29, audit Phase 5, security part 3
- Incident mode; shared accounts wait for the operator — 2026-10-29, audit Phase 5, security part 4
- Stored files have an owner — 2026-10-29, audit Phase 5, security part 5
- Two-factor sign-in — 2026-10-29, audit Phase 5, security part 6
- Every stored secret is on the keyring — 2026-10-31, audit Phase 5, security part 7
- Deleting a workspace keeps it for 30 days — 2026-11-01, audit Phase 5, security part 8
- Who may join, how they sign in, when idle access ends — 2026-11-01, audit Phase 5, security part 9
- Ideas: drafting order, Not yet, stale flags, lane health — 2026-11-01, audit Phase 5, growth part a
- Pause the social queue only; failed sends are told at once — 2026-11-01, audit Phase 5, growth part b
- Polling backs off; long strips fold; the Inbox streams; notices roll up — 2026-11-01, audit Phase 5, growth part c
- Articles: overlap checks, complete structured data, website health — 2026-11-01, audit Phase 5, growth part d
- Recommendations have a lifecycle; CTR and weighted position; the autonomy preview — 2026-11-01, audit Phase 5, growth part e
- Ideas in spreadsheets; people basics; contextual help — 2026-11-01, audit Phase 5, growth part f
- The assistant's run history and conversations — 2026-11-01, audit Phase 5, growth part g
- Discover any format per Topic; post lists on phones; the bundle check — 2026-11-01, audit Phase 5, growth part h
- Saved hashtag sets and snippets — 2026-11-01, audit Phase 5, growth part i
- Connections: needed vs optional, and whose key — 2026-11-01, audit Phase 5, growth part j
- The video studio is read-only for viewers — 2026-11-01, audit Phase 5, growth part k
- Wide report tables become cards on phones — 2026-11-01, audit Phase 5, growth part l
- Each project has an upload checklist; its page is read-only for viewers — 2026-11-01, audit Phase 5, growth part m
- Research reports you can use; generated blocks say who wrote them — 2026-11-01, audit Phase 5, growth part n
- Every report table downloads as CSV — 2026-11-01, audit Phase 5, growth part o
- Viewers get a read-only assistant — 2026-11-01, audit Phase 5, growth part p
- Posting slots follow the data — 2026-11-01, audit Phase 5, growth part q
- The public topic form has controls — 2026-11-01, audit Phase 5, growth part r
- Unfinished channels can be resumed or let go; a dial says who starts one — 2026-11-01, audit Phase 5, growth part s
- Research ideas can take a remixed title — 2026-11-01, audit Phase 5, growth part t
- Topics can be renamed, merged and safely deleted — 2026-11-01, audit Phase 5, growth part u
- The background queue has a page; a job that gives up says so — 2026-11-01, audit Phase 5, growth part v
- A rejection can say why, be undone, and steer discovery — 2026-11-01, audit Phase 5, growth part w
- Notifications open, filter, page and span workspaces — 2026-11-01, audit Phase 5, growth part x
- The sweep says what it will do next — 2026-11-01, audit Phase 5, growth part y
- Articles losing clicks become refresh ideas — 2026-11-01, audit Phase 5, growth part z
- A teleprompter driven by words per minute and the keyboard — 2026-11-01, audit Phase 5, growth part aa
- The Articles list filters, pages and acts in bulk — 2026-11-01, audit Phase 5, growth part ab
- The Sent list shows results; top performers can be reposted or made evergreen — 2026-11-01, audit Phase 5, growth part ac
- The script editor has an outline: sections, retention markers, find and replace — 2026-11-01, audit Phase 5, growth part ad
- Evergreen has controls and a library — 2026-11-01, audit Phase 5, growth part ae
- Duplicate ideas are flagged across formats and can be merged — 2026-11-01, audit Phase 5, growth part af
- Each article has a Performance tab — 2026-11-01, audit Phase 5, growth part ag
- Readability coaching per section — 2026-11-01, audit Phase 5, growth part ah
- Each campaign has its own page — 2026-11-01, audit Phase 5, growth part ai
- Ideas have detail pages — 2026-11-01, audit Phase 5, growth part aj
- Search anomalies reach the Inbox and the digest — 2026-11-01, audit Phase 5, growth part ak
- Social CSV import: template, dry run, timezone and media — 2026-11-01, audit Phase 5, growth part al
- Keywords edit in place and in bulk; ideas from keywords get real titles — 2026-11-01, audit Phase 5, growth part am
- RSS feeds filter by words, take the article's picture, and target default accounts — 2026-11-01, audit Phase 5, growth part an
- Article versions say who made them and can be compared before a restore; colour tokens are checked at build — 2026-11-02, audit Phase 5, growth part ao
- Articles preview their Google result and social cards as the fields are typed — 2026-11-02, audit Phase 5, growth part ap
- Automation shows a week of engine cycles, quiet runs folded and silences marked — 2026-11-02, audit Phase 5, growth part aq
- Dials say who changed them and what they were — 2026-11-02, audit Phase 5, growth part ar
- Posts can be saved as templates and copied to another workspace — 2026-11-02, audit Phase 5, growth part as
- The workspace switcher shows what waits elsewhere and keeps your place — 2026-11-02, audit Phase 5, growth part at
- Charts mark what happened: publishes, sends, automation changes and notes — 2026-11-02, audit Phase 5, growth part au
- Research suggests Topics for the outliers no Topic covers — 2026-11-02, audit Phase 5, growth part av
- The site's internal links are an inventory: who links to whom, orphans, offers both ways — 2026-11-02, audit Phase 5, growth part aw
- Review comments quote the text, @mention people, and can hold final approval — 2026-11-02, audit Phase 5, growth part ax
- Renders run in the background, show each scene as it goes, and re-render one scene — 2026-11-02, audit Phase 5, growth part ay
- Measure opens on every channel at once, and goals say whether the period is on pace — 2026-11-03, audit Phase 5, growth part az
- Personal settings: say what happened, a zone to read in, an email change that's proven, and deleting yourself — 2026-11-03, audit Phase 5, growth part ba
- Script versions compare like articles, and the editor never writes over a newer text — 2026-11-03, audit Phase 5, growth part bb
- Topics compare side by side, week by week and item by item — 2026-11-03, audit Phase 5, growth part bc
- A new workspace can start from one the operator runs — an allowlist travels, nothing else — 2026-11-03, audit Phase 5, growth part bd
- The operator sees every tenant's health on one page — 2026-11-03, audit Phase 5, growth part be

## Open items / things the user still owns
- **Analytics: APIs enabled 2026-08-03** (Search Console + GA Admin + GA Data, on project
  `479503233109` = `gen-lang-client-0838901195` = "CreateUp"). Still pending, user-only: add the
  SA as a user in Search Console (property `https://www.lsi-media.com/`) and as Viewer in GA4
  (property `361954739`), then save site URL + property id in Admin → Analytics (live probe).
  ⚠ A disabled API and a missing grant both return 403 `PERMISSION_DENIED` — `explainGoogleError`
  separates them, don't collapse that back to a `/403/` test.
- ~~Veo persistence has never run for real.~~ **PROVEN 2026-08-03** by the first paid render
  (2-scene board, `veo-3.1-fast-generate-preview`): both scenes persisted to Drive, `storedUrl`
  set, ffmpeg assembly produced a stitched file, SRT generated. The old default model id 404'd —
  see the trap table above.
- ~~Rotate `AUTH_SECRET`~~ — **done 2026-08-03** (32 random bytes, set via Railway variables).
  The `.test-cookies.txt` session token from `8daa5b7` is now dead regardless of the secret.
  Everyone was signed out once, as expected.
- **Custom domain:** if one is added in Railway → Settings → Networking, add the Google OAuth
  redirect URI in Cloud Console if SSO is enabled. No code/env change otherwise.
- ~~A workspace has a URL stored as its ElevenLabs key~~ — **FIXED 2026-08-03**: the owner pasted
  a real `sk_` key for CommunityForce; a live probe through `getTtsProvider` produced real audio
  stored to Drive. (LSI Media still deliberately on Mock — the owner's call, don't flip it.)
- ~~The assist + platform-key UI has only been driven as the platform operator.~~ **Verified
  2026-08-02** with a throwaway fixture user (ADMIN of Demo Workspace only, deleted after): the
  YouTube card renders read-only for a tenant admin (badge + tenant copy, no input/Save), the
  Storage section is operator-only as intended, and assist propose/discard works for a
  non-operator. ⚠ In passing this confirmed the Demo env back-fill is live for assist:
  workspace-level fields have no channel, so Demo resolves env `claude-sonnet` → the platform
  `ANTHROPIC_API_KEY` and gets **real** (unlabelled, correctly) Claude output on the platform's
  key. Known and deliberate — raise it, don't silently "fix" it.
- ~~A reported layout problem is unexplained.~~ **SOLVED 2026-08-03 (`bdbc002`).** The left
  rail's intrinsic height (~980px, 16 modules) exceeded shorter viewports; with no height cap or
  internal scrolling its content spilled past the shell, the window grew a scrollbar, and
  scrolling clipped the non-sticky header. Both screenshot reports (2026-08-01 "rail extending
  past the content", 2026-08-03 clipped header on /dashboard) were this one bug — not `zoom`,
  not a repaint artifact. Reproduced by measurement at a 720px viewport (document scrollHeight
  981 == the aside's content height) and re-measured fixed after deploy (720 == viewport; rail
  scrolls internally; Sign out reachable). The rail now caps at `100vh / --ui-zoom` — the same
  correction `.min-h-screen` gets in globals.css. ⚠ The window must never scroll in the app
  shell; `<main>` is the scroll container. Any new full-height sibling of `<main>` needs the
  same cap.

## Machine-level (not part of this repo)
User-level Claude skills are installed at `C:\Users\Admin\.claude\skills\`: `notebooklm-research`,
`watch`, and the ui-ux suite (`ui-ux-pro-max`, `banner-design`, `brand`, `design`,
`design-system`, `slides`, `ui-styling`). The `notebooklm` MCP server is registered at user scope;
it needs a one-time `uvx notebooklm login` (Google sign-in) the user must do.

