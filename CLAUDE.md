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

## ⚠ Ideas get made, and Intel's numbers are real and dated (2026-10-27, audit Phase 2, ideas group)
- **Every "Discover" goes through `discoverIdeasAction`** (IDE-03): Articles' buttons (`discoverBlogIdeasAction`) delegate
  to it with `formats=article, back=/blog` — per Topic, the manual ceiling, the person recorded. Don't call
  `discoverIdeasCore` from a button again (six untagged ideas a press, recorded as the sweep).
- **Approved ideas say what's holding them** (IDE-05): `lib/idea-blockers.ts` `draftingBlockers` names why the engine
  won't draft approved articles or social posts by itself (AUTOPILOT off, paused, the function's mode manual, the daily
  budget, the weekly cap, `social:autogen` off, the rotation rollback, no text-capable account). It MIRRORS the sweep's
  checks in `blog-autopilot.ts` and `social/drafting.ts` — keep them in step. The board shows "Approved, but not being made"
  and no longer promises the engine will make them.
- **Social ideas have Draft now** (`draftSocialIdeaNowAction` → `draftSocialIdeaNow`): the sweep's own writer
  (`writePostFromIdea`), without the autogen switch or the weekly quota (a person asked); it saves a DRAFT for them (no
  slot), `createdById` set, approval pending unless an admin pressed it. The idea is claimed in the write (conditional
  update after the post exists; the loser's post is deleted). A person's draft counts toward the weekly quota (volume),
  not the daily budget (`actorId` set).
- **Intel re-reads what it measures** (IDE-11): `lib/intel-index.ts` `indexIntelChannel` (moved out of the "use server"
  file — exports there are browser-callable) refreshes channel counts and every video's views/likes/comments/ratios with
  `IntelVideo.measuredAt` (migration `20261028110000_intel_measured_api_cache`). The channel page has "Re-read from
  YouTube" (`reindexIntelChannelAction`, ~4 units). "Outlier videos" is published in the last 30 days.
- **Unmeasured is a dash** (IDE-12): `formatNum(null)` is "—" everywhere; uploads/week is computed from upload dates at
  index ((n−1)/span); velocity was never computed — its filter, "Hot new channels" and the stat box are gone (the
  `velocity:` search token is ignored); comments are read (`commentCount`).
- **YouTube quota** (IDE-13): every Intel action that calls YouTube is EDITOR+, the competitor search is editors-only;
  `ytGet` meters each call into `UsageLog` (`action: "youtube.api"`, `tokens` = units: search 100, else 1), shown on
  Settings → Usage; `searchChannels` is cached per workspace and query for 24 h in `ApiCache`.

## ⚠ Models that can write, limits that hold, keys that stay (2026-10-28, audit Phase 2, settings group)
- **The router resolves every call's model** (SET-01): `llm.complete` / `llm.stream` run `resolveUsableModel` first,
  so a stored choice whose provider isn't wired or keyed (GPT, DeepSeek, Grok, Kimi, MiniMax, a keyless Claude, the
  mock) writes with the first reachable model instead of the mock. The reply's `model` is the one that ran. A BLANK
  model means inherit: the workspace's `defaultModel`, then `DEFAULT_LLM_MODEL` — the studio's chains end in `""` (they
  ended in `"claude-sonnet"`, so a channel on "Workspace default" never got it). Don't add `?? "claude-sonnet"` back.
- **Pickers offer only what can run**: `PICKABLE_MODELS` (lib/llm/models.ts — Anthropic and Google, no mock, no
  legacy alias) through `modelChoices()` with key status, rendered by `components/ModelOptions.tsx` (keyless options
  disabled; a choice stored before this stays listed and selectable, marked, with `ModelChoiceNote` saying what
  writes instead). Every save path calls `modelChoiceProblem(next, ws, current)` — an unchanged stored value passes, so
  an unrelated save never fails or silently changes it. The four pickers: workspace, channel, article, script.
  Wiring another provider = add it to `TEXT_PROVIDERS` + `getProvider` + `PROVIDER_LABEL`.
- **Soft limits are enforced where things are made** (SET-02): `lib/soft-limits.ts` `softLimitProblem(kind, ws, user)`
  — scripts (every `db.script.create` a person triggers, the API answers 429, the assistant's tools refuse),
  thumbnail sets (`thumbnail.brainstorm`/`thumbnail.clone` UsageLog rows), Agent Mode runs (`agent.run` row written
  at launch), channels (the workspace's). Per person, per UTC calendar month; the engine (no person) is held by the
  daily AI budget instead. A new creation path must ask it first.
- **Every AI call is metered** (`lib/usage-meter.ts` `meterAi`, from the two routers): `UsageLog` `ai.text` / `ai.image`
  with `provider`, `model`, `inputTokens`, `outputTokens` (migration `20261028120000_usage_provider_tokens`, plus the
  `[workspaceId, action, createdAt]` index). Mock replies are rows too (provider `mock`) — Usage names them as
  placeholders. Usage shows per provider/model, articles/social/images, and each limit against the busiest PERSON
  (it compared workspace totals with per-person caps); it links to Limits. No dollar figures — no price table is kept.
- **Save never clears a key** (SET-05): `saveApiKeyAction` / `saveSearchKeyAction` refuse an empty field; Remove key
  (`intent=remove`) only asks (`?confirmRemove=<id>`), `intent=remove-confirmed` clears. Works without JavaScript.

## ⚠ The studio writes only what a model wrote, and stops when told (2026-10-28, audit Phase 2, video studio group)
- **Placeholders are refused before they're written** (VID-05): `lib/studio-ai.ts` `placeholderProblem(res, outcome)` —
  every studio action that stores model text (canvas outline/script/humanize/improve, builder steps, promo assets,
  research reports, cloned templates, thumbnail concepts) checks it and redirects with `flashErr`, writing nothing.
  Long calls pass `STUDIO_TIMEOUT_MS` (the router's 45 s default turned long scripts into mock text). Thumbnail
  concepts are checked BEFORE the four paid image renders.
- **Templates and brand reach the prompts** (VID-13): `templateBlock(template)` renders a template's sections, timing,
  beats and pacing (cloned templates' `ai` JSON or built-ins' `sections`), not just its name. Thumbnails add the
  channel's `thumbnailConfig` (palette, typography, face position, style notes) and honour its
  `limitThumbnailsPerMonth`.
- **The script editor saves what's on screen first** (VID-06): Humanize and Improve `flush()` before calling the
  server (Improve's offsets are into the SAVED body); the editor is keyed on the row's `updatedAt`, so a server
  rewrite remounts it on the new text; unsaved typing is flushed on hide/unmount; a failed save shows "not saved".
- **A cancel holds** (VID-07, VID-09): the agent job claims `queued|running → running` conditionally, checks for a
  cancel after every model call BEFORE writing, and its finish/fail updates are conditional on `running` — a
  cancelled run is never overwritten. One run per script at a time. Renders: `cancelRenderAction` (queued or
  rendering → failed, "Cancelled by …"); `processRenderCore` re-checks `rendering` before each scene and its done/failed
  writes are conditional. `components/AutoRefresh.tsx` refreshes /videos and the storyboard while anything renders.
- **Veo lengths are 4, 6 or 8 s** (VID-11): `snapSceneSeconds` (lib/captions.ts) snaps on READ in `parseScenes`, the
  scene editor is a 4/6/8 select, and the length is SENT (`durationSeconds`) — it never was, so clips, SRT and cost
  disagreed. Packaging (VID-12) takes published posts with NO render, newest first, and moves past a failure.
- **No invented production numbers** (VID-08): "Sync stats now" wrote views/retention from a hash of the project id
  — it now refuses (a project isn't linked to its YouTube video); the project page shows none; onboarding ignores
  ChannelStat rows without a real 11-character video id (every existing row is one of those inventions). Chapters
  are COMPUTED from the script's headings at 150 wpm (`chaptersFromScript`). CTR scoring sends the rendered image to
  a vision model (`askAboutImage`); no image, no vision key or no number = no score (it stored 50).
- **Builder section regenerate splices** (VID-15) into the CURRENT body by the section's heading, sending that
  section's text; a heading changed on the Canvas is refused. Clone-from-URL (VID-14) reads a `watch?v=` /
  `youtu.be` / `shorts` link as THAT video and refuses with no transcript.
- **Task board** (VID-16): keyed on the tasks it's given (server changes show), a failed move rolls back
  (`moveTaskAction` returns `{ ok }`); `closeStaleAutoTasks` (lib/auto-tasks.ts, run by the cycle and the Tasks
  page) closes Review/Images/Render-failed auto-tasks the pipeline has moved past, matched by the link in their
  description. Teleprompter (VID-17): fixed-height `h-dvh` root + `min-h-0` scroller; stops at the end.

## ⚠ Reports say only what was measured; a refusing provider is named (2026-10-28, audit Phase 3, part 1)
- **`postPerformance` lists PUBLISHED posts unless told otherwise** (MEA-01, MEA-09, SHL-04) — newest published first;
  pass `status: "any"` for every status. The opt-in filter was the documented trap: the client PDF said "Nothing
  published yet", Measure counted drafts as tracked posts, the Inbox's Results were all dashes.
- **Compliance is counted, not asserted** (MEA-02): `lib/report-facts.ts` `complianceFacts` / `overrideSentence` — how
  many published posts went out under an admin override (the `blog.gate_overridden` audit row; the post's own
  override fields clear on edit). Never print a fixed "100% passed" again. Search Console is stated from the
  config and the last sync (`searchConsoleLine`, MEA-03).
- **Unmeasured is null, everywhere a sum is shown** (MEA-04): `homeStats.clicksThisWeek` is `number | null`;
  `sumMeasured()` for tiles; Insights' search metrics are null when no snapshot carried them; weekly series are
  labelled by the week's start date (not W1…W8) and the PDF prints "not measured" for an unmeasured week.
- **Social follow-through is SocialIdea → SocialPost** (MEA-08): a published post counts when a social post made
  from it went out (`posted`/`partial`; old SocialVariant rows still count). The report's social table reads
  `SocialPostTarget` legs per network.
- **Read pages read for everyone** (MEA-10): Social performance is `requireMembership`; its actions and each card's
  buttons are editors' (`PostCard readOnly`). Don't put `requireRole` on a page that only shows things.
- **A provider refusing a workspace's calls reaches the Inbox** (found 2026-10-28: LSI's Google credits ran out and
  the engine went quiet for days): `lib/llm/provider-health.ts` — the router records 402/credits, 429/quota and
  401/403/bad-key refusals per workspace and provider (`llm:refusal:<provider>`, at most one write per 10 min), a
  success clears it, and `lib/home.ts` shows "<Provider> is refusing this workspace's AI calls". Timeouts aren't
  refusals.

## ⚠ Windows end where the data does; rates have honest bases (2026-10-28, audit Phase 3, part 2a)
- **Per-post figures are 28-day windows** (MEA-14): `postPerformance` gives the impression-weighted position
  (`weightedPosition`) of the 28 days ending at the post's latest reading, `prevPosition` for the 28 before, and
  `clicks` summed over the window (`WINDOW_DAYS`). Single-day positions made "biggest movers" the noisiest days.
  `homeStats.avgPosition` is the same weighting over the workspace's last 28 days.
- **Like with like** (MEA-11): `publishedLastMonth` counts the SAME elapsed days of last month; weekly series end
  at the last day that has data (Search Console lags ~2 days), not "now".
- **Bases** (MEA-15): no cadence change on a zero earlier half; social impressions are impressions (reach no longer
  stands in) and the rate pairs engagement with impressions per reading; best time counts POSTS, not network legs;
  pipeline velocity is the median over ideas whose post published in the window (refresh ideas excluded, also
  from the funnel); the budget block is `generationsToday` against `DAILY_AI_BUDGET`. `sumOrNull` drops undefined.
- **A typed reading is one named day** (MEA-17): the manual entry has a date (default yesterday) and is refused
  where Search Console or GA4 already recorded that day for the post.
- **Posting timezone, said** (MEA-20): `lib/zoned-dates.ts` — `zonedMonthStart`, `zonedDayStart`,
  `formatZonedMoment` ("28 Oct, 00:50 EDT"). Month boundaries and printed engine times use the workspace's
  posting timezone and name it.

## ⚠ The audit, Topics and recommendations tell the truth about time (2026-10-28, audit Phase 3, part 2b)
- **YouTube audit** (MEA-12): cached per window AND connected channel (`youtube:audit:<days>:<channel>`); connected
  but no access token = an error saying the sign-in was refused (it read "not connected"); a failure is cached 10
  minutes (`youtube:audit_error:…`) so views don't re-run ~10 calls; `AuditVideo.reportPending` marks uploads
  inside the ~2-day Analytics lag with no row (a dash, not 0).
- **Topics** (MEA-13): the out rate is ONE cohort — of what was made in the window, how much is out (it divided
  everything published in the window by what was made in it, passed 100%, and could auto-raise a Topic's
  priority); clamped to 100. Measure → Topics names each column's window (counts all time; clicks, views and
  engagement over the range; position latest).
- **Recommendations** (MEA-16): each sweep RESOLVES open findings whose rule didn't fire (or fired with a different
  fingerprint — a bucket change), except rules that threw; `openRecommendations` sorts warning → opportunity →
  info (it sorted the strings, info first). Status values: open | accepted | dismissed | applied | resolved.

## ⚠ Shell copy says what was checked (2026-10-28, audit Phase 3, part 3a)
- **Connections is resolved like the providers** (SET-04): search/voice/video/YouTube keys fall back to the platform
  and env as the providers do; Writing counts only Claude/Gemini keys and shows "partial" while a provider is
  refusing calls (`providerRefusals`); storage reads `getStorageBackendSetting()` and flags local disk; mailboxes
  count only `status: connected`; analytics uses `gscConfigured` / `ga4Configured` (service accounts count).
- **Automation speaks plainly** (SET-13): function labels, not `fn=mode` tokens; the last cycle is summarised from
  its CycleReport (`cycleSummary`) in the posting zone; every mode/target/SEO/pause change redirects with a
  confirmation; mode buttons carry `aria-pressed`.
- **`stop(name)`** (lib/sentence.ts) adds the full stop only when the name doesn't already end one (SET-14).
- **Words from the actual condition** (SHL-12): the Inbox says "Everything is paused" when it is (never "The engine is
  running" then) and doesn't promise a digest without a connected mailbox; `/forbidden` takes `?need=ADMIN|EDITOR`
  (requireRole) or `?why=operator|member` and says which.
- **The engine pill** (SHL-03) shows the time today, "yesterday HH:MM", else "N days ago"; the ticker and feed name
  auto-advance, social posts written/queued, social ideation, holds and failures.
- **Inbox counts are totals** (SHL-05): `InboxData.counts` per group (images and claims filtered BEFORE the list is
  cut, with one query each for their audit records); groups show "Showing N of M".

## ⚠ Help, dates, outliers and the assistant stay current (2026-10-28, audit Phase 3, parts 3b and 4)
- **Help reads the navigation** (SHL-14): the guide's stage tabs come from `STAGES[...].tabs(...)` (`tabsOf`); when a
  page moves, fix Help's quick starts, shortcuts and the FAQ in lib/help.ts too — old paths there (Blog → Automation,
  Social → Workflow, Topics in Brand, a Review stage) were wrong for weeks.
- **One day format** (SHL-15): `formatDay(date, tz?)` → "28 Oct 2026"; moments via `formatZonedMoment` in the
  posting timezone. Don't print `toISOString().slice(...)` or a bare `toLocaleString()` to a person.
- **Outliers** (IDE-09, IDE-10): `OUTLIER_MIN_VIEWS` (1,000) — the indexer stores no score under it, averages Shorts
  and long-form separately and needs 3 of a format; lists filter on views; `outlierBand(null)` is "not scored".
  Research matches every indexed outlier per Topic and shows each group's true count.
- **Social copy** (SOC-27): Approvals says whether new posts queue (auto-queue) or wait; Engage's unread list is
  "Not marked seen yet"; Distribute's queue count is a count query, not the 10 listed.
- **Assistant** (ENG-30): its example prompts are swapped for this workspace's held article, approved idea and
  Topic (`examplesFor`); keep every example backed by a tool that does it; the app map names social ideas,
  Topics and today's Distribute and Measure tabs.

## ⚠ Speed: no server code in the browser, quiet pollers, warm pages (2026-10-28, audit Phase 4, part a)
- **The platform list is `lib/zernio/platforms.ts`, import-free** (PRF-03): `lib/social/networks` (used by the composer,
  calendar and editor) imported it from `lib/zernio`, which pulls in `node:crypto` and the settings/database layer —
  every such page shipped a ~500 KB crypto polyfill, twice. A client component must never import `lib/zernio` (or
  anything that reaches `node:*`); "use server" action files are fine — the browser gets references, not code.
  After the change no chunk in `.next/static/chunks` contains pbkdf2.
- **Header pollers back off** (ENG-29): AiActivity polls every 5 s while something runs or right after a click or
  submit, otherwise the gap doubles to a minute; one chain at a time (a run number); nothing while the tab is hidden.
  EngineStatus skips its minute while hidden.
- **Per-request and short caches** (SHL-20): `getCurrentUser` is React `cache()` — once per render (server actions
  run outside the render scope and read fresh); `stripCounts` is cached 10 s per workspace in-process, so a badge
  can lag a click or two.
- **Routes are warmed at boot** (PRF-01): `instrumentation.ts` requests `WARM_ROUTES` once, signed out, 5 s after a
  production start, and logs `[warm] N of 31 routes answered`. Add a page there when it becomes a common landing.

## ⚠ Heavy pages: Engage keeps its lists, the board drops its panels (2026-10-28, audit Phase 4, part b)
- **Engage's three lists are kept between visits** (SOC-26, `lib/zernio/inbox-cache.ts`): conversations, posts with
  comments, and reviews live in `ApiCache` (`zernio:inbox:<ws>:<list>:<net|all>`, one-day expiry). Under two minutes
  old → served as is; older or marked stale → served at once and re-read in `after()`; no copy or `?fresh=1` (Refresh
  now) → read before rendering. A failed read keeps the copy and the page names the failure. The open thread (messages
  or comments) is always read live. `markInboxStale(ws)` runs after a DM reply, a review reply, a comment, a comment
  delete and every inbox webhook delivery — a new write path into the Zernio inbox must call it too. Freshness lives in
  the JSON (`readAt`, `stale`), never in `expiresAt`: other ApiCache writers purge expired rows.
- **An article idea's tags and merge are on `/ideas/article/[id]`** (IDE-20, editors; role-links lists it): every
  board card carried that form plus a list of every other open idea and 60 site pages. The card links there; the
  actions take `back=edit` and redirect with a flash (the board's inline use had none).
- **The board reads open ideas apart from closed ones** (IDE-20): up to 200 discovered/approved per table, priority
  (or outlier score) `nulls: "last"`, plus the 60 most recently changed closed ones. Header counts still come from
  `groupBy` over everything. Postgres sorts NULL FIRST under DESC — always say `nulls: "last"` on a nullable rank.
- **Performance pages its history** (PRF-02): 25 a page (`?page=`), total from a count query.

## ⚠ Lint is clean — keep it so (2026-10-28, audit Phase 4, part c)
- **`npx eslint .` reports no errors** (PRF-04; it was 59 — 48 at the audit). Run it with tsc before a commit.
- **Apostrophes in JSX text are `&apos;`** (react/no-unescaped-entities) — the usual way the count grows back.
- **"Now" in a server render comes from `lib/request-time.ts`** (`requestNow`, `daysAgo`): reading the clock once per
  request is right on the server, but the React Compiler's purity rule can't tell a server component from a
  client one. Client components keep the clock in state (SocialCalendar's `useMinuteClock`) and check "has it
  passed" in the handler (`hasPassed`).
- **No components created inside a component** (react-hooks/static-components): the editor's toolbar `Tool`, the
  Inbox's `FollowLink`, RSS's `ModeSelect`, Analytics' `Status` / `CredLine` are module-level. A component made
  during render is a new type each render, so React remounts it.
- **Refs are written in `useLayoutEffect`, not during render** (BlogBodyEditor's `latest`, RichTextEditor's
  `handlersRef`); the editor's seed is `useState(html)`. Elsie stores the popup's measured height with its
  position. SocialCalendar's mount flag is `useSyncExternalStore` (false for the server render and hydration).
- **Deliberate exceptions say why, in place**: Elsie's two layout steps and PostingSchedule's browser-only zone
  read keep `setState` in an effect; post-card images stay `<img>` (stored files are session-gated, and
  next/image's optimiser fetches without the session). `_name` bindings are allowed by the lint config.

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
