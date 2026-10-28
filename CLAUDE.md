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

**Current work (2026-10-27): the audit plan** `docs/AUDIT-2026-10-25.md` (local, untracked) — its
Progress section says what has shipped and which Phase 2 group is next; the handoff entry is at the top of
§3 in `MEYOUSOCIAL-NEXT-SESSION.local.md`; the verify-before-push recipe is `.claude/skills/meyousocial`
§7. Each shipped part's rules are a section below.

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

## ⚠ Nav invariants after the 2026-09-20 UX audit
- **The rail is 12 entries, not 14.** `Review` and `Publish Admin` are gone. Review WAS the Inbox
  — both rendered the same `<NeedsYouGroups>` — so `/review` redirects to `/inbox`, and its tabs
  (Approvals, Audit) are Publish's.
- **One Articles page.** `/blog` takes `?view=board` (default) or `?view=list`; `/blog/board`
  redirects. `stages.ts` has ONE Drafts tab for it, with `also: ["/blog/board"]`.
- **Every retired URL still resolves** via a page-level `redirect()` — there is no `redirects()`
  block in `next.config.ts` and never has been. `/dashboard`, `/review`, `/blog/board`, `/admin`,
  `/blog/automation`, `/blog/settings`, `/social`, `/social/settings`.
- **One "Ask" at any width**: header button `md:` and up, floating dock pill below it. The stage
  Ask drawer is deleted. `.btn` is unlayered, so the header button needs `!hidden md:!inline-flex`.
- **Empty states go through `components/EmptyState.tsx`** — one sentence saying WHY, and at most
  one primary button. `action={null}` with a `note` when the viewer genuinely can't act.

## ⚠ Topics are the spine (2026-09-21 — design doc "Topics as the spine")
- **Topics live under Ideas** (`/ideas/topics`, per-Topic page `/ideas/topics/[id]`), not Brand.
  Brand keeps a one-line pointer with `id="topics"`. The actions stayed in `actions/brand-hub.ts`
  and redirect through `topicBack()` — pass a hidden `back` field, held to `/ideas*` or `/brand*`.
- **Three idea tables, one board.** `BlogIdea` (article), `Idea` (video), `SocialIdea` (social) —
  `lib/ideas-board.ts` renders them as Topic LANES. Don't merge the tables; don't add a fourth
  vocabulary. The "No topic yet" lane is `topicId: null` EXPLICITLY (NOT/notIn drops NULLs).
- **Every engine-written idea carries a Topic.** Ideation runs per Topic × format through
  `lib/ideation.ts` (`runIdeation`, emptiest cells first, bounded per call); the unfocused
  `discoverIdeasCore(ws, null)` is the fallback for a workspace with no Topics only. Video ideas
  are tagged at birth by keyword match (`lib/topic-match.ts`) — computed, labelled, never stored
  as a fact elsewhere.
- **Counts across all three formats**: the `/ideas` badge (`stage-counts.ts`), the Inbox
  "ideas to triage" card and pipeline strip (`home.ts`). A video idea's "discovered" is `new`.
- **A social post starts as an idea.** Sweep step 3 in `blog-autopilot.ts` is ideation
  (`social/ideation.ts`: per Topic, and a published article's angles) → the gate
  (`ideas:social_gate`, `social/gate.ts`: `auto` default approves the ENGINE's own ideas in the
  same sweep; `human` leaves them on the board; a person's ideas always wait for that person) →
  drafting (`social/drafting.ts`: one approved idea per sweep → a post, written exactly as
  autogen wrote it, same weekly quota). `social/autogen.ts` (Topic rotation) and
  `generateVariantsCore` are the ROLLBACK behind `social:source = rotation` — set only by an
  operator, never from the UI. Full autonomy sets the gate to `auto` and snapshots it.
- **Measure → Topics** (`lib/topic-measure.ts`, `/measure/topics`): every cell measured or a
  dash with the reason; YouTube numbers are matched to a Topic BY KEYWORD (`kw`) because no
  link exists from a render to the uploaded video — labelled, never stored.

## ⚠ Socialmonials parity (2026-10-17 — the team's white-label posting tool, brought in)
- **`platformSpecificData` is built ONLY in `lib/social/platform-options.ts`** (`buildPlatformData`).
  Zernio stores unknown keys silently, so every field there is one docs.zernio.com documents:
  `firstComment` (Facebook, Instagram, LinkedIn, YouTube — not Stories, not X, not TikTok),
  `tiktokSettings` (privacy has NO default by TikTok's rules; duet/stitch/AI flag only for video),
  `contentType` (story/reel). "Move link to first comment" runs AFTER UTM tagging.
- **Optimal = the measured best time only** (`lib/social/optimal.ts` over `best-time.ts`), else the
  composer says why. Never a guessed hour.
- **Watermark** is composited at SEND onto the uploaded copy (`lib/social/watermark.ts`); the
  stored original is untouched. Client components import positions from `watermark-options.ts`
  — importing `watermark.ts` pulls `sharp` into the browser bundle and the build fails.
- **Categories** are a workspace list (`social:categories`, `lib/social/categories.ts`), still the
  slot lane. **`SocialPost.source`** is stamped on every creation path; `post-lists.ts` derives it
  for older rows. Queue/Sent/Drafts: one component, `components/PostList.tsx`.
- **⚠ Full autonomy auto-queues every UNSCHEDULED draft** (blog-autopilot 3¾). Anything that
  saves date-bound drafts (Caption Studio) keeps `scheduledAt` on the draft — a draft with a time
  is never auto-queued, the same convention the approval workflow uses for held posts.
- **Caption Studio** (`/social/captions`, `lib/caption-studio/*`, `actions/caption-studio.ts`):
  the team's "Caption Prompts & Scenarios" doc — special days (SpecialDay rows; pasted dates are
  never guessed, rolled-forward ones are unverified), weekly campaign, from image descriptions,
  event countdown. Output is a CaptionBatch reviewed before any post exists; flags come from
  `checks.ts` and are shown, never auto-fixed. X gets the batch's short version or is left off.

## ⚠ Security invariants (2026-10-25, audit Phase 0 — `docs/AUDIT-2026-10-25.md`)
- **Fail closed on config.** `AUTH_SECRET` has no default (empty → Auth.js refuses requests);
  `USE_MOCK_LLM` defaults to false. Never reintroduce a fallback secret or a mock-by-default flag.
- **Sign-up is by invitation** unless `ALLOW_OPEN_SIGNUP=true` (default off). The form also opens
  for the very first account on an empty install. An invitation is claimed ONLY with its token
  (`/signup?invite=…`, `/invitations/<token>` signed in as the invited address) or after the address
  is verified (`verifyEmailAction`). Never claim by typed email. All three doors go through
  `lib/invitations.ts` `claimInvitation` — atomic, and it never lowers an existing active role.
  Revoking/removing a member withdraws their pending invitations.
- **Stored HTML is stripped of executable markup** by `lib/html-safety.ts` `stripExecutableHtml`:
  on body save (both actions), in the rich editor's seed, in `renderForPublish` and both exports,
  and first inside `sanitizeRichHtml`. It is a denylist that keeps sections/styles/ids — don't swap
  it for the allowlist on the body. ⚠ The Write/Edit tools turn ` `-style escapes into literal
  characters; that file uses numeric code-point checks on purpose.
- **Assistant confirmations**: a proposal runs only when the whole reply is a bare yes
  (`isAffirmative`), expires after 15 minutes, and is claimed atomically from the thread before it
  runs. `schedule_article` is ADMIN-only; tool times without a zone are read in the posting timezone.
- **Tenant boundaries on shared platform accounts**: only the operator adopts unclaimed Unipile
  mailboxes; the hosted-auth callback needs the single-use `<workspaceId>:<nonce>` it was issued
  and never reassigns an owned account. Analytics never falls back to the shared platform service
  account unless the operator lists the workspace in the platform Setting
  `analytics:platform_sa_workspaces`; site/property/OAuth identity keys are workspace-only
  (`WORKSPACE_ONLY_KEYS` in `lib/settings.ts`). YouTube/Analytics OAuth `state` is a single-use
  nonce (`lib/google/oauth-state.ts`). SMTP save/test reuse a stored password only from the
  workspace's own row with the same host+user, and refuse private hosts (`lib/net/public-host.ts`).

## ⚠ One actor at a time (2026-10-26, audit Phase 1, first part)
- **Article publishing is claimed**: `publishCore` moves the post final_approval/published →
  `"publishing"` with a conditional update before anything touches WordPress, releases it on every
  failure, and refuses any post that already has a `wpPostId`. Before creating it asks
  `wpFindRecentPostBySlug` (same slug + title, modified in the last 2 h) and adopts that post, so a
  create that timed out after succeeding isn't repeated. A claim older than 15 minutes is released by
  the sweep (`releaseStalePublishClaims`). "publishing" is a transient BlogPost status — lists may not
  show it.
- **One autopilot cycle per workspace**: `runAutopilotCycle` takes the lock
  `autopilot-cycle:<workspaceId>` for every entry point (sweep, "Run cycle now", the assistant); a
  second caller gets `skipped: "busy"`.
- **Social sends are claimed**: only the scheduler passes `{ claimed: true }`; every other
  `publishSocialPost` caller claims draft/scheduled/failed/partial → publishing atomically and stops if
  it loses. A post with no targets goes back to draft instead of sending. The scheduled-send sweep
  skips globally paused workspaces.
- `lib/redis.ts` resets `authed` with every new socket — a dropped connection used to leave every lock
  "unavailable" until a restart.
- **Article ideas become articles only through `draftIdeaCore`** (`lib/idea-drafting.ts`) — the sweep,
  Draft now, Auto-draft approved and the assistant. It claims the idea (conditional update), copies the
  Topic, audience, tier and motifs into the post and gives the writer the angle. `ideaChange()` decides
  what an idea means: a **refresh** (has `refreshPostId`) revises that published post in place —
  `refreshStartedAt` set, back through review, and its publish **updates the same WordPress post**
  (`wpUpdatePost`; the publish sweep picks refreshes up too); **Retire / Merge, or a Refresh / Rewrite
  with no post in the app, are site changes** a person makes in WordPress — never drafted. Rescoring
  keeps a refresh idea's `refreshPostId`.
- **Renders are claimed** queued → rendering; a retry skips scenes already `done` with output; a render
  stuck in "rendering" over an hour is released to **failed** (not queued — a person retries it).
- **The global pause is enforced at the routers**: `llm.complete/stream` and `images.generate` throw
  `GenerationPausedError` for a paused workspace. Only the assistant's own conversation passes
  `allowWhilePaused`; its tools are gated in `runTool`, where a tool marked `deescalates` (unschedule,
  reject, autonomy/function off, the pause itself) still runs. Paused workspaces' jobs wait unclaimed and
  the sweep skips them; the evergreen recycler skips them.
- **Assistant "draft" tools ask first when the engine would ship the result** (`confirmWhen`):
  draft_social_post and draft_article under full autonomy; advance_article and answer/dismiss_finding
  when publishing is on auto.
- The pause and full-autonomy forms post the state they mean (`intent`); a stale tab can't flip them
  back. `enableFullAutonomy` is a no-op when already on, so the restore point survives.
- **Any fetch of an outside address goes through `safeFetch`** (`lib/net/safe-fetch.ts`): public hosts
  only, every redirect hop re-checked. Stored files are served with `nosniff` + a sandbox CSP, and
  logos are PNG/JPEG/WebP only (an SVG can carry script).
- Assets have an owner (`Asset.workspaceId`); every asset read and write filters on it. Ids taken from
  a form (upload chat/script/channel, task project/assignee, bookmark targets, script template/voice)
  are checked against the workspace before the write.
- **A script is snapshotted before anything overwrites it** (`snapshotScript`, `lib/script-versions.ts`)
  — regenerate, stream, the agent, the builder — and every snapshot can be viewed and restored. "▶
  Produce video" is gone: it re-ran the writing agent and made no video.
- Zernio: `ensureZernioProfile` never adopts another workspace's `ws_*` profile, and adopts an unclaimed
  one only on the workspace's own key.
- **An approval covers what was reviewed** (2026-10-27, Phase 1 third part): with `social:require_approval`
  on, a non-admin's edit that changes an approved post's text, media, first comment or networks sends
  it back to pending (and so does scheduling a post nobody reviewed — the calendar drag and the
  assistant's queue/schedule tools refuse it like the Queue button). An auto-image landing on a post a
  reviewer approved re-pends it. RSS drafts are stamped pending while the workflow is on. The
  scheduled-send sweep still sends `approval = null` — engine posts carry null and the engine's own
  idea gate governs them. ⚠ The hold state (SOC-04) is still NOT built — don't add one without the owner.
- **A dated draft keeps its date**: Queue all drafts / bulk Queue schedule a draft that has a
  `scheduledAt` AT that time (skipped once past); only undated drafts take slots. Caption Studio never
  saves a special-day or countdown caption without its time and skips one whose day has passed.
- **Social sends**: the Zernio request id is built from STORAGE KEYS (upload URLs change per attempt);
  a 200 replay keeps each leg's own status; a timeout/abort is recorded as "may have posted anyway" and
  Retry warns (`lib/social/unknown-outcome.ts`). `reconcileStuckSocialPosts` (social sweep) settles posts
  quiet in "publishing" for 15 min from `GET /posts/{id}` (probed 2026-10-27) — it never sends.
- **An article's approval covers its words** (ART-09/21): "Advance anyway" is pinned to `gateOverrideHash`
  (md5 of the body); `returnToReviewAfterEdit` (lib/blog-gates.ts) sends a final-approval article back to
  review — clearing `scheduledAt` and the override (`CLEAR_APPROVAL`) — after Save, autosave, version
  restore, Regenerate, the craft/optimize buttons and the assistant's set_article_fields, and turns an
  edit to a live WordPress article into a refresh. Back out of final approval clears them too. Regenerate
  on a live article revises it (refresh brief); on one published by hand off the app it's refused.
- **Held articles are named** (ART-08): auto-review takes the least recently reviewed (`autoReviewedAt`),
  sets aside day-held claims before taking three, and the publish step runs `blockingChecks` before picking
  two (skips workspaces with no WordPress); /publish and the Inbox show the failing check at final approval.
- **Article variants post through the social pipeline** (ART-11): ADMIN, article published with its URL;
  `postSocialVariantAction` creates a SocialPost and calls `publishSocialPost` (claim, UTM, guards).

## ⚠ Times, mail and the engine's failures (2026-10-27, audit Phase 2, first part)
- **A typed date-time is wall clock in the POSTING timezone** (`social:timezone`), never the server's UTC:
  `parseZonedInput` / `toZonedInput` in `lib/social/slots.ts` — the composer and edit page, the article
  schedule, CSV import (one shape only, `2026-12-11 09:00`; `11/12/2026` is refused, not guessed) and the
  assistant all go through it, and the fields are labelled with the zone. The calendar drag still sends an
  instant computed in the browser — that one is right as it is.
- **App mail (reset, verification) leaves from a mailbox of the person's OWN workspace** (`appEmailFor`,
  `lib/email`) — never another company's. No mailbox → mock, and the forgot page says to ask an admin.
  Admins have **Reset link** on Settings → People (`lib/password-reset.ts`): refused for yourself, the
  platform operator, and anyone who also belongs to a workspace the admin doesn't administer — a reset
  link IS the account. Token helpers live outside the "use server" file on purpose.
- **A mocked send is not a delivery**: `notify()` stamps `emailedAt` only on mail that left; the digest
  records `notify.digest_undeliverable` (once a day) instead of `digest_sent`. `publish_failed` is deduped
  per entity + title for 24 h (`DEDUPE_HOURS` in `lib/notify.ts`).
- **Analytics sources sync independently** (`lib/analytics/sync.ts`): a failed source keeps its earlier
  numbers, the other replaces its own; pages are fetched in full (`gscQueryAll` / `ga4RunReportAll`) and URL
  variants of one post ADD. The last outcome per source is `analytics:sync_status` — the Analytics tab
  shows it, Insights names a failing sync instead of "connect", the Inbox warns after two failures.
- **The daily AI budget gates generating only**, counts only unattended work (`actorId: null` — so
  `blog.draft_generated` / `social.variants_generated` now carry the person who asked) from midnight in the
  posting timezone. Publishing, advancing and queueing run regardless; the report says `budgetReached`.
- **Each autopilot step runs on its own** (`step()` in `runAutopilotCycleUnlocked`): a throw is recorded in
  `failedSteps` and `autopilot:cycle_status`; the Inbox warns after two cycles. A throw inside drafting
  puts the idea back like a refusal (reason `error`).
- **Job retries back off** (`Job.runAfter`: 1, 4, 16 min ±20%). The sweep skips a job until then.

## ⚠ What reaches people is real, and nobody's edit is undone (2026-10-27, audit Phase 2, second part)
- **A placeholder is never stored as output.** The agent job, onboarding (voice, audience, starter ideas)
  and the canvas chat resolve a model the workspace can reach (`resolveUsableModel`), give long output
  `timeoutMs`, and stop on `provider === "mock"` before writing — the agent run fails naming the step;
  the chat stores a "(No answer…)" line; onboarding keeps its baseline, which is flagged `placeholder: true`
  and labelled on the audience page. Starter ideas are JSON with a seed number: an idea carries the outlier
  figure of the seed IT adapts or none, and real ideas replace the five generic ones.
- **Uploads**: images are captioned by a vision model (`askAboutImage`) or stored without a caption and
  said so; PDF and Word are refused (no parser installed) instead of stored as a stub. Chat context items
  are read (`fetchPageText`, the research row's content) or labelled unreadable. Mock search is labelled.
- **Conversations load the NEWEST N messages** (desc + take + reverse) — assistant turn, dock reload, canvas
  chat, the script page's chat pane.
- **The article editor never writes over text it didn't start from** (ART-01/03): `BlogBodyEditor` gets
  `serverHash` (bodyHash of the stored body) and sends `baseHash` with autosave and Save; the server refuses a
  stale base, keeps the person's text as the version "your edit, kept — the article changed elsewhere", and
  the editor offers Load the latest / Keep mine. A new stored body with nothing unsaved is simply loaded.
  Pending typing is flushed on unmount and when the tab hides; leaving with unsaved text warns; a failed
  autosave says so. Each AI draft is kept as a version.
- **Source markers** (ART-19/20): ONE tolerant pattern (`markerRegex` / `countMarkers` / `hasMarker` in
  `lib/citations-extract.ts`) — [Needs Source], [NEEDS SOURCE: …], [NEEDS CITATION], [citation needed] — used
  by the gate, the extractor, auto-review and the slop check. `syncMarkerRows` (lib/citation-rows.ts) gives
  every marker its citation row on every edit (it runs inside `returnToReviewAfterEdit`). publishCore and
  the hand-off publish refuse a body that still has a marker, override or not.
- **WordPress images** (ART-06): featured, OG and inline app images go to the media library
  (`uploadImageToWp`, `rewriteInlineImages`); the SEO plugin only ever gets a PUBLIC og:image
  (`publishReport.ogImageUrl`), inline uploads are remembered per stored file (`Setting wp:media:<ws>:<key>`).
- **A draft hand-off isn't live** (ART-10): publishedUrl stays null (the draft link is `publishReport.draftLink`);
  Approve & publish / Publish now runs `publishWordPressDraftCore` — status set on the site, read back, and
  only `publish` makes it published. Publish labels hand-off rows. A refresh at final approval goes through
  publishCore (it used to fall through to a bare status flip).
- **No WordPress, no bare flip** (ART-12): the editor shows Download HTML + Mark as published; the live
  URL is required (`markPublishedManuallyAction`, `back=editor` returns to the article).

## ⚠ One set of network rules; the queue keeps its places (2026-10-27, audit Phase 2, social group)
- **Network rules live in `lib/social/validate.ts`** (`legProblem` / `postProblems` / `scheduleRefusal`): YouTube and a
  Facebook Reel need a VIDEO (`requiresVideo` — the app attaches images only, so the composer marks them "not available
  yet"); Instagram, TikTok, Pinterest, Snapchat and Stories need an image; TikTok needs a chosen audience; and each
  network's character limit. Every path that schedules asks `scheduleRefusal` — composer and edit saves (not drafts),
  the calendar drag, Queue, Queue all, bulk Queue, Approve (approves but keeps it a draft, saying why), the assistant's
  queue/schedule, and full autonomy's auto-queue (skips it; reads 100 drafts, queues up to 10). The SEND checks each leg
  on its TAGGED text: a refused leg fails with its reason and the rest go; with nothing left Zernio isn't called, not even
  to upload images. Drafts are exempt everywhere (SOC-19).
- **An unreadable image stops the send** (SOC-09): `makeUploader` throws on a failed storage read, so every leg fails
  naming the file, and Retry works. It used to post text-only and mark the legs posted.
- **The assistant's draft_social_post writes Zernio's account id** and the account name (SOC-07), not our row id.
- **Webhook** (SOC-15): only post.published / post.failed / post.partial change anything. A partial is settled leg by leg
  from `GET /posts/{id}` (`settleLegsFromZernio`), and a posted leg is never moved back. A workspace can set its own
  `zernio:webhook_secret` (Settings → Connections, beside its own key); a delivery verified by it touches only that
  workspace. The route answers 503 only when there is no secret anywhere.
- **Slots are claimed, not read** (SOC-16): `claimFree` reserves the workspace-minute (Redis `SET NX`, 3 min; a process
  map without Redis). Queue, Queue all, bulk, autonomy and evergreen all go through it, looking through 2000 slot instants.
- **`SocialPost.timeChosen`** (migration `20261028100000_social_post_time_chosen`): true when a person picked the moment
  (schedule, optimal, the drag, a dated CSV row, Caption Studio's dated captions), false when the queue placed it.
  Removing a slot or changing the posting timezone moves only `timeChosen: false` posts. A new zone re-anchors them to the
  same local time (the checkbox is on by default; one whose new time has passed goes back to drafts). A removed slot sends
  them back to Approvals only when `require_approval` is on, otherwise to drafts. Older rows default to false, so they are
  treated as queue-placed, which is how everything was treated before.
- **Editing keeps per-network fields** (SOC-18): a network with its own first comment or images opens customized, so its
  fields are submitted; "Use base" clears that network's own images (`perNetworkMarks` + `custom_<P>`). A stored Reel stays
  selectable in the dropdown — a disabled option isn't submitted, and a save would have made it a feed post.
- **Sent posts are the record** (SOC-20): deleting goes through the registry kind `socialPost` (DeleteButton confirmation,
  audited) and only for `DELETABLE_POST_STATUSES` (draft, scheduled, failed); `deleteSocialPostAction` is gone.
  `/social/[id]` is the read-only post page: each network's status, link and error, with Retry failed and Duplicate.
  The editor redirects sent posts there, and Sent rows have Retry on failed and partial posts.

## ⚠ Every link goes somewhere this person can open (2026-10-27, audit Phase 2, shell and assistant group)
- **`lib/role-links.ts` is the map of role-gated pages** (`roleNeededFor` / `canFollow` / `whoCanFix`): ADMIN = `/admin/*`
  and `/setup/people`; EDITOR = the social pages (compose, calendar, approvals, engage, performance, a post's edit page),
  `/assistant*`, `onboarding/channel/new`; everything else is any member. ⚠ It MIRRORS the page gates — a page that changes
  its `requireRole` must change here too. Surfaces that link across roles ask it and, when the answer is no, say who can
  act (`components/RoleLink.tsx`, or plain text) instead of a button that bounces to /forbidden: the Inbox's condition
  cards and pipeline strip, Settings (no People tab or card link for non-admins; Connections rows), Distribute, Help and
  the owner's guide, and the stage strip, which drops tabs the role can't open (Compose, Calendar… for a viewer).
- **"N things need you" counts only what this person can act on** (`getInboxData(…, { admin, editor })`): post approvals
  and invitations are an admin's, article work an editor's; a viewer's is zero. A condition only an admin can fix doesn't
  make the header say something needs you.
- **The assistant is for editors and admins** (ENG-17): viewers get no rail entry, Ask button or dock; `/assistant` tells
  them why; `/api/assistant` answers a viewer with a JSON 403 (it used to redirect, and the dock parsed /forbidden as JSON).
- **The dock's conversation is per workspace AND person** (ENG-18): localStorage `mys.assistant.thread:<ws>:<user>` (the old
  unscoped key is removed on load), the dock is keyed by workspace so a switch remounts it, and a send to a conversation
  that's gone starts a new one with that message.
- **Header pollers read the ACTIVE workspace** (ENG-19): `activeWorkspaceIdFor(userId)` in `lib/acl.ts` (the cookie, else
  the first membership — `requireMembership`'s choice) for `/api/ticker` and `/api/ai-activity`; EngineStatus is keyed by
  workspace.
- **An article that passes every check at review has "Move to final approval"** on its Inbox card (SHL-06, editors,
  `advanceBlogStatusAction` with its own server-side gate). Without full autonomy nothing moves it on by itself, and the
  card says so; under full autonomy it neither counts in the Inbox nor turns the Drafts badge red.
- **Elsie** (SHL-08): steps anchor only on real elements — `npm run check:guide` (`scripts/check-guide-anchors.mts`) fails
  when an anchor exists nowhere or a route/link is missing or redirect-only; run it after renaming a rail entry or moving
  a page. `stepVisible` skips setup steps for non-admins, rail anchors not on THIS person's rail (Settings, Channels and
  Brand are admin-only), routes/links their role can't open, and studio steps while the studio is off. A route that
  redirects no longer strands her: she navigates once and then looks on the page she landed on. Her keys (arrows, Escape)
  are live only while her popup is on screen.
- **A member of nothing can always sign out** (SHL-11) — the operator's "Create your workspace" form too.

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
