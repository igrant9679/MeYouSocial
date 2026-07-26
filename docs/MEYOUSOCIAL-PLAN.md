# MeYouSocial — merge plan (Spark + CreateUp)

_Locked 2026-07-22 with the product owner. This repo was seeded from CreateUp
(`igrant9679/CreateUp` @ `58ab0e0`) and is being merged with Spark
(`sgrant5724/spark`) into one app: **MeYouSocial**._

## Locked decisions

| Decision | Choice |
| --- | --- |
| Shell | **CreateUp is the base** (Next 16 / React 19 / Tailwind v4); Spark's modules port in |
| Repo | New **private** repo (CreateUp's is public; client operations cannot live there) |
| Branding | **CreateUp design system** — coral `#E5482F`, hue-token chips, IBM Plex. Spark's LSI palette is retired (LSI Media becomes a workspace, not the app brand) |
| Autonomy | **Three-mode dial on every major function**: `manual` / `assisted` / `auto` (see below) |
| Video | **Fully rendered videos** as the goal; shipped phased — packages exist today, rendering added behind a `VideoProvider` seam, short-form first (per-second API pricing makes long-form auto-rendering a deliberate opt-in) |
| Spark prod | **Frozen as of 2026-07-22.** LSI Media migrates to MeYouSocial as soon as the blog pipeline boots here; accept a temporary feature gap |

## The mode dial (core governance concept)

Every major function carries a per-workspace (later per-channel) mode:

- **manual** — human drives; AI assists on click (today's CreateUp/Spark behavior)
- **assisted** — AI runs the work autonomously, then **queues at a human checkpoint**
- **auto** — end-to-end unattended, governed by spend caps, quiet hours, and the
  global kill switch

Function domains (initial): `ideation`, `blog_drafting`, `video_packaging`,
`video_rendering`, `publishing`, `social`. Seed of the model: Spark's
`AutomationSetting` (per-content-type mode, spendCap, maxAutoPublish, quietHours,
globalPause) — port and extend its enum to the three modes.

## What each parent contributes

**From CreateUp (already here):** Next 16 shell + branding, workspaces/roles/ACL,
LLM router with DB-first keys + mock fallback, jobs queue (Redis-ready), Agent
Mode (research→outline→draft, SSE), channel intel, script canvas + builder,
thumbnails, production suite, admin (users/keys/SMTP), public `api/v1`.

**From Spark (to port):** blog pipeline (idea → grounded draft → SEO → WCAG
gates → WordPress publish → social variants → analytics), org/SME grounding
profiles, motif system, audit log, kill switch + automation guardrails,
truthfulness rules (never invent metrics; `[NEEDS SOURCE]` → citations; publish
blocked while unverified), Postgres **RLS** two-role isolation, agency
(multi-client) console, client PDF report.

## Phases

- **0 — Foundation**: boot clone ✅ → rebrand shell to MeYouSocial → private
  repo + fresh Railway (Postgres + Redis, clean admin creds, live Anthropic key,
  new AUTH_SECRET).
- **1 — Governance core**: three-mode dial + kill switch + audit log + spend
  caps; RLS hardening.
- **2 — Blog pipeline port**: Spark's articles/SEO/WCAG/WordPress/social/
  analytics modules, restyled to hue tokens; migrate LSI Media data.
- **3 — Autonomy engine**: Redis-backed schedules; idea→draft→gates→publish
  loops honoring each function's mode.
- **4 — Video**: real YouTube Data API; `VideoProvider` seam (Veo via
  `@google/genai` first): script → scenes → clips → voiceover → assembly →
  publish. Short-form first; long-form auto-render is opt-in with a hard spend cap.

## Carried-over blockers (from the parents)

- CreateUp Anthropic key has $0 credits (mock fallback hides it) — use Spark's
  live key on the new infra, or a Gemini key.
- Rotate `AUTH_SECRET` on the new deployment (historic cookie leak in CreateUp).
- CreateUp admin lockout is moot here: fresh DB + `SEED_ADMIN_PASSWORD` set from
  day one.
- Spark cred rotation (Railway token, DB password, login, Anthropic key) still
  owed on the Spark side while it remains live.

## Conventions

CreateUp's rules carry forward (see `CLAUDE.md` / `AGENTS.md`): Next 16 — read
`node_modules/next/dist/docs/` before framework work; hue tokens (never raw hex
for colored chips); no billing/payments; DB-first key resolution; mock fallback
means "it works" ≠ "key is live"; `tsc --noEmit` + `npm run build` before every
commit. Spark's truthfulness + human-gate guardrails apply to all ported and new
generation surfaces.

---

## FR gap-closure plan (added 2026-07-22 — NEXT MANDATE)

Audited against `docs/spark-capability-requirements_2.html` (FR-1→FR-18).
Scorecard: 3 mostly-done (FR-1, FR-6, FR-13) · 10 partial · 5 missing.
User approved autonomous gap closure in this order:

1. **7 Motifs system (FR-2)** — ✅ **shipped 2026-07-22.** Editable versioned
   directives (`MotifDirective` + `MotifDirectiveVersion`, seeded per workspace
   from the framework, restorable/resettable), weighted multi-select per post
   (dominant sets structure + voice, secondaries colour intro + CTA),
   `PlatformMotif` per-channel mapping, `MotifDefault` by tier/audience with
   most-specific-match resolution. Wired into drafting, outlining, social
   variants, video packaging, A/B titles and meta. Replaced the 4-option tone
   select (column kept, unused). `BrandKit` adds colours/fonts/logo/footer
   credit/tone guardrails, the H1–H6 px + margin spec, and editable
   featured/OG image dimensions. Admin UI at `/blog/brand`.
   _Not yet applied:_ the heading spec is stored but only rendered at publish in
   step 3; image dimensions are enforced by the step-2 asset gate.
2. **Asset pipeline + gate (FR-8)** — ✅ **shipped 2026-07-23.** `BlogImage`
   (featured + og per post) with dimensions *measured* from the file header
   (PNG/GIF/JPEG/WebP) rather than typed; mismatch warnings name the fix.
   Briefs grounded in the brand kit + motif with anti-stock guidance; AI
   generation behind a workspace toggle, landing `pending` until a human
   approves. Checks joined the shared gate, governed by
   `BrandKit.requireImagesToPublish` (default **on**).
   _Debt:_ no server-side image processing (no `sharp`), so the spec's
   "offer crop/resize" is a precise warning instead.
3. **Publish fidelity (FR-7/FR-11/FR-6)** — ✅ **shipped 2026-07-23.** SEO
   plugin field map (`src/lib/seo-plugins.ts`) with built-in Yoast + Rank Math
   keys and per-install overrides; **every publish reads the post back and
   reports which meta WordPress actually stored** (`BlogPost.publishReport`) —
   WP silently drops meta keys not registered `show_in_rest`, and Squirrly
   keeps SEO in its own tables, so its map ships empty on purpose. Canonical +
   OG overrides, categories/tags (resolve-or-create by name), author lookup,
   featured-image upload into the media library, draft-in-WP handoff (guarded
   against duplicate hand-offs via `wpPostId`), heading spec applied as inline
   styles + footer credit at publish, canonical slug rule with an apply action,
   external-source suggestions (search-key gated, never auto-inserted),
   deterministic publisher notes, the house template, and tier→track length
   defaults.
   _Not done:_ update-in-place for an already-published post (create-only),
   Nifty sync, and the FR-18 design-system rendering profile.
4. **SME profiles (FR-3)** + idea-engine depth (FR-5) — ✅ **shipped
   2026-07-23.** `SmeProfile` + versions: the ten-question intake captured once
   per expert, topic-based auto-matching (explicit pin wins; no match returns
   nobody rather than guessing), always/never-say injected as hard rules, and
   draft answers seeded from a URL or pasted source without overwriting
   anything the expert wrote. UI at `/blog/experts`. Ideas now arrive tagged
   (tier, audience, target page — only pages we actually know, suggested motif
   blend, seasonal hook) with a **deterministic** priority score computed from
   the keyword strategy, page map and published archive; the breakdown is
   stored and shown. Dedupe flags near-duplicates and turns badly-ranking
   matches into refresh candidates. Merge, edit, approve/reject, send-to-draft
   on the board at `/blog/ideas`.
   _Not done:_ voice intake for SME profiles (no transcription in-app), and
   FR-5's external discovery sources (People-Also-Ask / community questions /
   competitor gaps) still need real data providers.
5. **Notifications (FR-16) + check depth (FR-9/FR-10)** — ✅ **shipped
   2026-07-23.** `Notification` + per-user, per-kind `NotificationPreference`
   (in-app always available, email opt-in over the existing SMTP layer, and
   `notify()` never throws — a notification must not break the publish it
   reports). Events: approval needed, published, publish failed (the autopilot
   used to swallow these), scheduled, assigned, comment. Bell + unread badge in
   the header; inbox and preferences at `/notifications`.
   Checks gained FR-9 descriptive link text (**required** — WCAG 2.4.4, same
   treatment as alt text), empty-link and unlabelled-control checks, and FR-10
   anti-slop: filler-phrase list, unsourced-claim detection at sentence level,
   literal breaches of the brand guardrails / expert never-say list, and a
   missing-SME-grounding flag — all deterministic (`src/lib/blog-slop.ts`), so
   a verdict is reproducible and arguable rather than a model's opinion.
   Reviewer assignment + inline comments anchored by quoted text (not offsets,
   which later edits would silently invalidate).
   _Not done:_ Slack delivery (needs an app registration + OAuth) and Nifty
   two-way sync.
6. **Larger / externally gated** — the two buildable items are ✅ **shipped
   2026-07-23**:
   - **FR-18 design-system rendering** (`src/lib/design-render.ts`): draft
     patterns (benefit lists, tip/note/warning callouts, blockquotes, FAQ
     sections, CTA links, rules) map to Gutenberg blocks, Avada/Fusion
     shortcodes, or classed semantic HTML, per-pattern toggles, applied at
     publish only — the stored draft stays clean HTML so it can be re-rendered
     when the theme changes. Semantics preserved: checklists stay `<ul>`,
     accordions use `<details>`/core-details. The editor shows the exact
     rendered output before publishing.
   - **FR-15 content audit** (`src/lib/content-audit.ts`): read-only crawl of
     the connected site (page-inventory fallback), scored with the same
     deterministic detectors as the publish gate, recommending
     keep/rewrite/merge/retire with the score breakdown shown. **Retire always
     means redirect, never delete**; findings can be pushed to the idea board.
     Ranking data only exists for posts this app published — the UI says so
     rather than implying coverage it doesn't have.

   **Still genuinely gated** (need credentials or a third-party account you'd
   have to provide): GSC/GA4 connectors (Google OAuth), Uniple, Nifty,
   Microsoft SSO (Azure app registration). MFA is buildable without anything
   external but touches the live auth flow, so it wants its own session.

Conventions unchanged: dual-push (origin + deploy), tsc exit-checked + build
before push, offline migrations via `prisma migrate diff`, mock-first seams,
truthfulness rules on every new generation surface.

---

## UI/UX build-out (user-approved from round-4 mockups — ALL 5 SLICES SHIPPED 2026-07-23)

Commits 65521ea → 088bbfa, each deployed + verified live:

1. **Blog workspace** — sticky sub-nav with live badges on every /blog page
   (`blog/layout.tsx` + `BlogSubNav`), full-width kanban home, editor split
   into Write/Optimize/Assets/Distribute/Review tabs (URL param, no form spans
   tabs) with the Gates sidebar visible from every tab.
2. **Reports hub** — `/reports` nav module: 10 stock reports + custom builder,
   15-block library (`report-defs.ts` + `ReportBlocks.tsx`), per-workspace
   `ReportConfig` overrides (stock reports without a row track code defaults),
   PDF export via pdfkit (`serverExternalPackages` — it reads .afm from disk).
3. **Motion pass** — LIVE audit-log ticker in the header (server-seeded,
   60s client refresh via /api/ticker), shimmer `loading.tsx` on 8 routes,
   page-enter template, nav-icon lift, button press, one-shot badge pop; all
   reduced-motion-safe.
4. **Videos** — 3–4 scene storyboards (editable until rendering), scene-by-
   scene rendering with progress persistence, provider output downloaded to
   storage (Veo URIs expire ~2d), deterministic SRT from scene durations,
   honest-mock TTS seam (ElevenLabs activates in-app). Admin → API keys gained
   *Media & video*: renderer switch (auto/mock/veo), TTS switch, YouTube +
   ElevenLabs keys; YouTube lib resolves keys DB-first per call.
5. **Production** — DnD task kanban (native HTML5, select fallback per card),
   workspace WIP limit, stale/overdue flags, per-person capacity, auto-created
   tasks from pipeline events (review parked / images missing / render failed;
   deduped; rules + WIP editable in-app on the Tasks page), unified calendar
   (blog scheduledAt joins project publish dates).

Help page updated throughout (Blog workspace, Reports, Videos, production
board/auto-tasks/calendar, ticker, content size, nav/logo).

**Honest debts from the build-out:** ffmpeg assembly of scene clips into one
file (seam exists, mock = per-scene playback); YouTube *upload* (needs OAuth,
not just the Data API key); ⌘K palette + version-diff view (blog polish);
Slack notifications; DnD for the blog kanban (production board has it, blog
home cards are links).

---

## Storage: Google Drive backend (shipped 2026-07-23)

Closes the "uploads are ephemeral on Railway" debt. `src/lib/storage/` now
dispatches per-key: new files go to the backend selected by Setting
`storage:backend` (DB-first, env fallback — same pattern as `video:provider`);
reads route on the key prefix (`gdrive:<fileId>` vs legacy bare local keys), so
switching backends never breaks existing URLs. The Drive adapter
(`src/lib/storage/gdrive.ts`) is dependency-free: service-account JWT via
node:crypto, Drive v3 REST multipart upload into one shared folder,
`supportsAllDrives` throughout.

Serving is **private-by-default**: `/api/files/<key>` streams Drive files to
signed-in members with Range passthrough (video seeking works); the public
uc?id= hotlink route was rejected — unreliable for embeds (virus-scan
interstitials) and it would make every render public. Bonus fix: `/uploads/<key>`
now has a real serving route — local StoredFile URLs previously pointed at
nothing and 404'd everywhere.

Admin → API keys → **Storage**: backend switch (blocked until configured),
service-account JSON + folder (URL or id) settings, and a live connection
banner showing the SA's real quota usage. Saving the folder / switching to
Drive runs a **write-then-delete probe** so misconfiguration or exhausted quota
fails at save time with a plain message. Honest limits stated in-app: SA-owned
files consume the SA's own 15 GB on personal Drives (Shared Drives pool);
existing local files are not migrated (ephemeral anyway).

**Activation is user-gated:** create a Google Cloud service account (Drive API
enabled) → JSON key → share a Drive folder with it as Editor → paste both under
Admin → API keys → Storage → switch backend to Google Drive. Until then new
files keep landing on local disk (ephemeral on Railway).

---

## Responsive width pass (shipped + verified live 2026-07-23)

Root cause found: the content-size setting applies `zoom` to `<body>`, which
shrinks *effective* layout width ~18% at XL while viewport media queries stand
still. Fix: the app shell and `<main>` are CSS **@containers**; the affected
chrome and page grids use Tailwind v4 container variants, which measure the
zoomed space. Verified on production at 1280/1024/768/375 and under simulated
XL zoom (`body.style.zoom=1.22`).

- Left rail auto-collapses to a 68px icon rail below 72rem effective width
  (labels become tooltips; MobileNav below md unchanged, labels intact).
- Header sheds in priority order (ticker narrows → email, "Manage channels"
  drop → "+ Channel" drops → role chip hides on phones). Bonus bug from live
  verify: unlayered `.btn` CSS beat the layered `hidden` utility, so the two
  channel buttons had been visible at every width since the header shipped —
  now `!hidden`-marked.
- Blog editor: gates grid/aside breakpoints unified (was lg: grid + xl: aside
  = phantom empty column at 1024–1280); below the threshold a compact gates
  strip (pass count, blocking chip, score → Review) shows on every tab. Under
  XL zoom on wide screens the collapsed rail frees enough width that the full
  sidebar *stays* — measured, not hoped.
- BlogSubNav: honest scroll-edge fades (only while more tabs exist in that
  direction) + active tab auto-centers into view.
- Week ribbon: horizontal scroll track below ~42rem effective (was 7×50px).
- Reports hub 1/2/3 cols, customize aside, TaskBoard 1→3 cols, Videos
  storyboard 1/2/3/4 cols — all container-based now. Storyboard grid is
  code-verified only (no renders existed in prod to click through).

---

## Multi-tenancy (shipped + verified live 2026-07-23, commit 2ce3f3f)

Multiple companies share one install without sharing anything else. Row-level
isolation was already solid (audited); what was global was CONFIG. Now:

- **`WorkspaceSetting` table** (migration `20260723183000`) + `src/lib/settings.ts`
  resolver: workspace row → platform `Setting` row → env var, 30s cache. Every
  provider config rides this.
- **API keys per workspace**: `LLMRequest.workspaceId` threads through the LLM
  router; search/TTS/video/Veo/YouTube (`youtubeFor(wsId)`) resolve the
  company's key first. 78 call sites threaded across 28 files — every LLM/
  provider call in the app carries its workspace. Admin → API keys saves
  workspace rows; chips show "your key" vs "platform key in use" and platform
  key material is never displayed to tenant admins. The Storage card (platform
  infrastructure — one store serves all tenants) is visible/editable only for
  `BOOTSTRAP_ADMIN_EMAIL`.
- **SMTP per workspace**: `emailFor(wsId)` — notifications + invitations go out
  through the company's own server (platform fallback); password reset and
  verification stay on the platform sender (no workspace context pre-login).
  IMAP deliberately absent — the app only sends; the page says so.
- **Teams**: `signup?invite=<token>` joins the inviting company directly (the
  token used to be ignored — invited users got a stray personal workspace);
  accepting an invite sets the active-workspace cookie; multi-company users get
  a header workspace switcher (`requireMembership` honors the cookie).
- **Branding per workspace**: `Workspace.accentColor` + `logoKey`; Admin →
  Workspace → Branding (preset swatches + hex, logo upload via storage). The
  shell injects theme-aware CSS-token overrides — the FULL alias family
  (`--brand*`, `--accent*`), because custom properties capture their scope at
  definition; hex is re-validated before touching CSS. Verified live: accent
  round-trip re-tints chrome incl. the AA-darkened primary button, reset clean.
- **Leak fixes**: `production:autotasks` was a global singleton (one company's
  board rules governed every tenant); two legacy search-singleton calls
  bypassed per-workspace keys. **By-design global**: the Intel index (public
  YouTube metadata cache, workspace-scoped bookmarks on top) — revisit only if
  indexed-channel lists are considered sensitive.
- _Verified live:_ migration applied, per-workspace key chips, scoped email
  page, branding card, workspace switcher, accent round-trip. _Code-verified
  only:_ the invite-signup join (needs a second real account to exercise).

---

## Unipile: email delivery + social posting (shipped 2026-07-23, commit 75e6aba)

**Why:** Railway blocks all outbound SMTP (587/465/2525 all ETIMEDOUT vs
known-good servers — proven via the test-send). Unipile is a unified HTTPS API
that connects end-users' mailboxes/social profiles and sends on their behalf
over :443, which is never blocked. It's now the primary email path.

- **`src/lib/unipile/`** — dependency-free client. DSN (host:port from the
  Unipile dashboard) + `X-API-KEY`; endpoints under `/api/v1`. `hostedAuthLink`
  (wizard), `sendEmailViaUnipile` (POST /emails, HTML body, multipart),
  `createPostViaUnipile` (POST /posts), `getUnipileAccount`/`listUnipileAccounts`
  + `classifyAccount`. `accounts.ts` resolves a workspace's default email/social
  account from the DB.
- **Config is PLATFORM-level** (one Unipile account serves all tenants):
  Settings `unipile:dsn` / `unipile:api_key`, operator-set via Admin →
  Connections (gated to `BOOTSTRAP_ADMIN_EMAIL`), env fallback
  `UNIPILE_DSN`/`UNIPILE_API_KEY`. `setPlatformSetting()` added to settings lib.
- **Per-workspace connected accounts**: `UnipileAccount` model (migration
  `20260723210000`) — one row per mailbox/profile, `{workspaceId, accountId,
  kind:email|social, provider, name, isDefault, status}`.
- **Connect flow**: `/admin/connections` → connect buttons build a hosted-auth
  wizard link (name=workspaceId) and redirect. On success Unipile POSTs
  `/api/unipile/webhook` `{status:CREATION_SUCCESS, account_id, name}` → we
  **re-fetch the account against our own key** (forged payloads can't attach a
  bogus account) → upsert the row. Page lists accounts with default/disconnect.
- **Email**: `emailFor(workspaceId)` prefers a connected Unipile mailbox → SMTP
  (still there but blocked here) → mock. Admin → Email now flags the SMTP block
  and points to Connections.
- **Social**: blog social variants gained **Post now** (Distribute tab) →
  `postSocialVariantAction` publishes the copy (`{{URL}}` substituted) via the
  workspace's connected account for that network, then marks posted; manual
  "Mark posted" kept.
- _User action to activate:_ operator pastes the Unipile DSN + API key
  (dashboard.unipile.com), then each workspace connects its mailbox/profiles.
  Until then email falls back (mock) and Post now reports "no account connected".
- _Fixed en route:_ `SubmitButton` now merges a caller-passed `disabled` with
  the pending state (was overridable, would have re-enabled pending buttons).

---

## Social scheduler — Buffer/Hootsuite-style (shipped 2026-07-23, commit 200c359)

Full social posting + scheduling on the Unipile connect flow.

- **Schema** (migration `20260723223000`): `SocialPost` (text, mediaKeys JSON,
  scheduledAt, status draft|scheduled|publishing|posted|partial|failed) +
  `SocialPostTarget` (provider, unipileAccountId, per-leg status/providerPostId/
  error). One post fans out to N accounts; each leg's status is independent.
- **`/social`** (new nav module): `SocialComposer` (client) — multi-account
  picker, live char counter vs the tightest selected network's limit
  (`src/lib/social/networks.ts`: LinkedIn 3000 / X 280 / Instagram 2200,
  IG requires media), image attachments, Post now / Schedule. Queue: Scheduled
  grouped by day (agenda), Drafts, History — per-network status chips + Retry
  (re-sends only non-posted legs) / Duplicate / Cancel (→draft) / Delete.
- **Publish** (`src/lib/social/publish.ts`): `publishSocialPost` posts each
  pending target via Unipile (media read back from storage), rolls status up.
  `publishDueSocialPosts` atomically claims due rows (scheduled→publishing) so
  concurrent sweeps can't double-send.
- **Scheduler**: `instrumentation.ts` arms a dedicated social sweep (default
  60s, `SOCIAL_SWEEP_SEC`) — tighter than the 30-min autopilot so posts fire
  near their scheduled time. Single-replica (same caveat as autopilot).
- `createPostViaUnipile` extended for image attachments (multipart).
- _Needs Unipile active + a connected social account to actually post._
- **Per-network variants — text (commit 34f4887) + images (commit 4a73a80):**
  `SocialPostTarget.text` (migration `20260723233000`) and
  `SocialPostTarget.mediaKeys` (migration `20260723235500`) override the base
  per network; publish uses `target.text ?? post.text` and the target's media
  keys when set, resolving attachments per target through a per-key fetch cache
  so an image shared across networks downloads once. The composer's Customize
  toggle covers both: its own textarea (own live char count vs that network's
  limit) and its own image picker (`media_<PROVIDER>`), falling back to the base
  when left empty. Queue cards show base image count plus each network's
  overridden text/"own image" lines and mark customized chips; duplicate carries
  everything. _Bug fixed here:_ removing a media chip previously only updated
  React state while the file input still submitted the file — removal now
  rewrites the input's FileList via `DataTransfer`.
- _Deferred:_ full drag-calendar (agenda ships), draft text editing
  (duplicate/delete workaround), link-preview/first-comment, threads.
  Single-replica scheduler (no Redis lock).

---

## Brand hub — workspace identity (shipped + verified 2026-07-24, commit 3a6530f)

**Audit finding first:** colours, company info, personas, keywords and social
accounts were ALREADY per-workspace — just scattered under the Blog section, so
they read as blog settings rather than company identity. Topics were the one
genuine gap. So this slice consolidates rather than rebuilds.

- **NEW `Topic` model** (migration `20260724001500`): per-workspace themes with
  description + related phrases, active/archived, unique per workspace. Distinct
  from `Keyword` (search phrases with tier/intent/cluster) and
  `SmeProfile.topics` (one persona's expertise). Full CRUD on the hub.
- **NEW `/brand` module** (nav entry): brand colours/fonts/logo/footer credit
  (inline), app-appearance summary (chrome accent + logo → `/admin/settings`),
  company info (inline, reuses `saveOrgProfileAction`), Topics CRUD, plus live
  summaries + deep links for personas (`/blog/experts`), keywords
  (`/blog/keywords`), social accounts (`/admin/connections`) and tone/asset
  policy (`/blog/brand`). Existing rich editors are NOT duplicated.
- **`saveBrandIdentityAction` is deliberately focused** — reusing
  `saveBrandKitAction` would read the whole brand form and silently reset image
  dimensions, render profile and the FR-8 asset-policy booleans (including
  `requireImagesToPublish`, which gates publishing) that this page doesn't
  render. Hex is validated.
- _Verified live:_ all 7 sections render; Topic create (with keywords persisted),
  duplicate-name guard, and delete all exercised on production then cleaned up.

---

## Topics across all six content surfaces (shipped + verified 2026-07-24)

A Topic is defined once in **Brand** and then flows through every content
surface. `Topic` itself: migration `20260724001500`, per-workspace, unique name,
description + related phrases (JSON), active/archived.

### The six surfaces

| Surface | Model.field | Migration | Commit |
| --- | --- | --- | --- |
| Channel ideas (YouTube) | `Idea.topicId` → rel `workspaceTopic` | `20260724024500` | `caa98a3` |
| Blog ideas | `BlogIdea.topicId` | `20260724020000` | `2471518` |
| Blog posts | `BlogPost.topicId` | `20260724013000` | `5ef9d18` |
| Videos | `VideoRender.topicId` | `20260724031500` | `4c86b04` |
| Production projects | `ContentProject.topicId` | `20260724034500` | `3a68e59` |
| Social posts | `SocialPost.topicId` | `20260724010000` | `11bf0a9` |

### Cross-cutting behaviour

- **Inheritance** (no re-selecting at hand-offs):
  `BlogIdea → BlogPost` (`draftFromIdeaAction` + `autoDraftApprovedAction`) and
  `BlogPost → VideoRender` (`packageVideoCore`). A topic chosen at ideation
  reaches the rendered video untouched.
- **Steering, not just labelling** — `discoverIdeasCore(workspaceId, topicId?)`:
  with a focus topic, its name/description/phrases go into the prompt ("EVERY
  idea must belong to this topic") and results are stamped; without one, active
  topic NAMES are supplied as context but **nothing is stamped** — a free-text
  idea can't be mapped back to a topic without guessing, and a confidently wrong
  tag corrupts topic reporting later.
- **Social composer extra**: the selected topic's related phrases render as
  click-to-insert chips, so topics actively help writing.
- **Every FK is `ON DELETE SET NULL`** — deleting a topic clears the tag and
  never deletes content. This is the single most important invariant here; a
  cascade would silently destroy posts/ideas/renders when someone tidied their
  topic list.
- **Every setter validates the topic against the caller's workspace**, and for
  the nested surfaces validates the parent too (channel ideas via
  `channel.workspaceId`, projects likewise).
- **`Task` deliberately has NO topic** — a task's topic is its parent project's.
  Storing it on both would let them drift and give two disagreeing answers to
  "what topic is this work under?".
- **Naming note**: `Idea` already had a free-text `topic` string (the channel's
  niche, set at onboarding). That column is untouched; the relation is named
  `workspaceTopic`. Renaming the old field would have broken the onboarding job.

### Verification record (honest)

_Topic-deletion (`SET NULL`) actually exercised against live tagged content on
**four** surfaces:_ blog posts, channel ideas, videos, production projects — in
each case the content survived (HTTP 200), the tag cleared, no dangling
reference. _Not exercised:_ blog ideas (the test idea was deleted before the
topic, so the tagged-idea path wasn't hit) and social posts (creating one needs
a connected Unipile account). Both use the identical FK clause as the four
proven ones.

_Also code-verified only:_ `packageVideoCore` topic inheritance (needs a real
packaging run — LLM + render budget), and AI idea discovery output quality
(the Anthropic key is at $0, so generations fall back to mock; the topic
plumbing is verified, the generated text is not).

---

## Scene assembly — one file out of a storyboard (shipped 2026-07-24)

The seam noted in `src/lib/video/index.ts` ("Long-form assembly (multi-clip +
ffmpeg stitch) is a later step, gated on infra") is closed. A multi-scene board
used to end as N separate clips the user played one by one; the deliverable is
now a single file.

**No infra change was needed.** `ffmpeg-static` is an npm dependency shipping a
per-platform binary, so Railway's Nixpacks image is untouched (no apt/nix
package, no `nixpacks.toml`). Binary resolution is layered:
`FFMPEG_PATH` env → `ffmpeg-static` → bare `ffmpeg` on PATH. `ffmpeg-static` is
listed in `serverExternalPackages` — bundling it would rewrite the path its
module exports and the spawn would fail.

**The chain** (`src/lib/video/assemble.ts`):

1. **Read back** each scene clip. App-relative URLs (`/uploads/<key>`,
   `/api/files/<key>`) are read through the storage layer, *not* fetched —
   both routes are session-gated and a server-side fetch would 401. Only
   `http(s)` provider URLs are fetched.
2. **Normalize** each clip onto one canvas (9:16 → 720×1280, 16:9 → 1280×720,
   1:1 → 1080×1080) via `scale…force_original_aspect_ratio=decrease` + `pad`,
   30fps, h264/yuv420p, aac 48k stereo.
3. **Concat** through the concat demuxer.
4. **Mux** a real voiceover over the whole cut when one exists (it *replaces*
   the clip audio — that's the right call for narration). The narration is
   `apad`-ed and `-shortest` then stops at the **video's** end, so the cut
   always survives intact whichever track is longer.
5. **Store** via `storage.put` → `VideoRender.assembledUrl`.

**Decisions worth not re-litigating:**

- **No ffprobe.** `ffmpeg-static` ships no probe binary. Instead each clip is
  normalized assuming it carries audio (`-map 0:a:0`) and retried against an
  `anullsrc` silent track when that mapping fails. This is what makes a board
  that *mixes* Veo clips (audio) with silent ones work — verified against
  exactly that mixed case.
- **Video is stream-copied at concat, audio is re-encoded.** Copying audio too
  emits `Non-monotonic DTS` at every segment boundary (AAC priming samples) and
  shifts timestamps. Re-encoding only the audio costs almost nothing and the
  video never takes a second generation of loss. Verified: `-c copy` warned,
  `-c:v copy -c:a aac` was clean, both at the correct duration.
- **`-shortest` alone was a bug, caught in testing.** Without `apad`, muxing a
  2s voiceover over a 6.04s board produced a **2.0s file** — `-shortest` had
  truncated the video down to the narration. With `[1:a]apad[a]` the output is
  6.039s in both directions (2s and 10s narration), verified.
- **Captions are not burned in.** Burn-in needs libass and makes the caption
  text unfixable after the fact; the SRT sidecar stays the deliverable.
- **Assembly never fails a render.** It writes `assemblyStatus`
  (`assembling|done|failed|unavailable`) + `assemblyError` and leaves `status`
  alone — a render whose stitch failed is still a successful render with
  playable per-scene clips. `unavailable` (no ffmpeg binary) is reported
  distinctly from `failed`, and suppresses the button rather than offering an
  action that cannot work.
- **EDITOR-level, re-runnable.** Unlike rendering it spends no provider money,
  only CPU. Re-assemble after regenerating a voiceover.
- Guards: ≥2 rendered scenes, 200MB in, 200MB out, 5-min ffmpeg timeout, temp
  dir always cleaned in a `finally`.

Migration `20260724050000_video_assembly` (three nullable columns). The Videos
list now previews `assembledUrl ?? outputUrl` — `outputUrl` is only scene 1 on
a multi-scene board, so it never wins.

**Storage caveat:** assembled files land in whatever `storage:backend` is set
to. Until the user activates Google Drive, that is local disk — wiped on every
Railway redeploy, same as renders and voiceovers.

---

## Branded shorts — BrandKit-themed title cards via HeyGen HyperFrames cloud (shipped 2026-07-24)

A "designed video" surface alongside Veo. HyperFrames (HeyGen's open-source
"write HTML, render video" framework) renders **exact, on-brand** motion
graphics from brand data; Veo generates footage from a prompt. Complementary,
not a swap — the `VideoProvider` seam (`{prompt,seconds,aspect}`) was the wrong
shape, so this is its own path.

**Spike first, then wired.** A scratchpad spike proved one template re-themes
per tenant purely from injected variables (coral MeYouSocial vs teal LSI, same
composition). Then wired to the app.

**Why cloud.** Rendering a HyperFrames composition needs headless Chrome +
ffmpeg. `hyperframes cloud` runs both on HeyGen's infra, so Railway needs **no
Chromium** — the whole app-side path is HTTP. (`hyperframes lambda`/`cloudrun`
exist for self-hosted farms; not used.)

**Dependency-free client** (`src/lib/branded-video/heygen-cloud.ts`), same house
pattern as `storage/gdrive.ts`. Contract reverse-read from the hyperframes CLI
source (v0.7.71):
- `POST /v3/hyperframes/renders` `{ base64 | asset_id | url, aspect_ratio, fps,
  quality, format, variables }` → `render_id`
- `GET /v3/hyperframes/renders/{id}` → `{ status, video_url }`
- auth header `x-api-key`; base `https://api.heygen.com` (override
  `HEYGEN_API_URL`); responses wrap `data`; terminal statuses `completed|failed`.

**No zip-upload round-trip.** The composition bundle is built into a
STORED/DEFLATE zip **by hand** (Node ships no zip writer — ~60 lines, in the
spirit of gdrive.ts's hand-rolled JWT) and **base64-submitted inline**.
_Verified:_ the hand-built zip extracts with a standard `unzip` and the extracted
composition passes `hyperframes check` (0 errors, WCAG AA 21/21). The only
unexercised step is the paid HeyGen API call itself.

**Wired to BrandKit** (`src/lib/branded-video/index.ts`): `brandKitToVariables`
reads the workspace's BrandKit colours + footer + name, falls back to the app's
coral tokens for anything unset, and picks an AA-contrast text colour by WCAG
luminance. _Verified against the live prod DB_ for real workspaces (names
resolve, fallbacks apply, eyebrow uppercased, white text chosen).

**Gating (house pattern).** `heygen` is a first-class key provider
(`keys.ts` + env; Setting `api_key:heygen` DB-first, env `HEYGEN_API_KEY` /
`HYPERFRAMES_API_KEY` fallback). No key → the Distribute tab shows "add a HeyGen
key", never a fake. Admin → API keys has a HeyGen row.

**Surface.** A post's Distribute tab (approved/published) gets a "Render branded
short" button + a gallery of that post's shorts (status, inline video, download,
delete). EDITOR-gated (spends credits). Finished MP4s are persisted through the
storage layer — HeyGen's signed `video_url` is time-limited.

Model `BrandedShort`; migration `20260724060000_branded_short`.

**Free local render fallback (2026-07-24, added after the cloud path).** Two
render paths, resolved per call (Setting `branded_short:mode`, default `auto`):
- **local** — free; shells the pinned HyperFrames CLI when a real Chrome is
  already resolvable (`CHROME_PATH`/`PUPPETEER_EXECUTABLE_PATH` env, or a system
  install). It **never** triggers HyperFrames' managed Chromium download — that
  restraint is the whole point, so Railway (no Chrome) always lands on cloud,
  while a dev box or a self-hosted worker with Chrome renders for free.
- **cloud** — HeyGen HyperFrames cloud, pay-per-credit (needs `api_key:heygen`).
`auto` prefers local when Chrome is present, else cloud. `brandedShortReadiness()`
reports which path a render would take and drives the UI copy.
_Verified:_ `renderLocally()` produced a real MP4 on the dev box (system Chrome +
ffmpeg, zero credits) — so the local path is proven end-to-end, unlike cloud.
Local render lives in `src/lib/branded-video/local-render.ts`; ffmpeg comes from
`ffmpeg-static` (`FFMPEG_PATH`), Chrome from the env/system resolver.

**Chrome on Railway → free rendering there too (2026-07-24).** Rather than
paying HeyGen credits on Railway, the image now carries Chrome so the free local
path runs there. Builder is **NIXPACKS** (confirmed from build logs — the
dashboard's "RAILPACK" manifest field was stale). `nixpacks.toml` adds Chrome's
shared libraries + `ffmpeg` via **additive** `aptPkgs` (Node toolchain
untouched); `railway.json`'s build command appends a pinned Chrome-for-Testing
download (`@puppeteer/browsers`) to `/app/.cache/chrome`, which persists into the
single-stage runtime image. `resolveChrome()` globs that cache, so
`localRenderAvailable()` is true on Railway and `auto` picks local (free). We do
NOT apt-install `chromium` (Ubuntu ships it as a snap shim that won't launch in a
container).

_Blockers hit + fixed while landing this (each a green deploy after a safe failed
build — atomic deploys kept prod up throughout):_ (1) the base is Ubuntu **noble
24.04**, so jammy lib names failed — switched to the `t64` set; (2)
`@puppeteer/browsers` couldn't extract — the noble base ships **no `unzip`**;
added it; (3) switched the download to `hyperframes browser ensure` (pinned
Chrome the renderer is tested with) over `@puppeteer/browsers @stable`. Final:
the build downloads **chrome-headless-shell** to
`/root/.cache/hyperframes/chrome/.../chrome-headless-shell` (HyperFrames uses its
own cache dir, ignoring `PUPPETEER_CACHE_DIR`) and writes that absolute path to
`/app/.chrome-path`; `resolveChrome()` reads it with an `existsSync` guard, so if
the path ever fails to resolve at runtime it degrades safely to cloud, never a
crash. Deploy `c926e2d` is green; the runtime render itself is exercised by
clicking Render on the Videos page (couldn't drive the signed-in UI from here).

_Chrome download cached across builds (2026-07-25):_ `nixpacks.toml`
`[phases.build] cacheDirectories = ["/root/.cache/hyperframes"]` + the build
copies Chrome out of the cache mount into `/app/.chrome` (a real image layer)
before capturing the path — cached AND in the image. **Confirmed** across two
deploys: the cache-populating build logged 12 Chrome download-progress lines, the
next build logged **0** (`browser ensure` found it in the mount instantly), and
build time roughly halved.

**Standalone shorts (no blog needed).** The Videos page has a compose card
(headline + eyebrow) + a gallery of all workspace shorts —
`renderStandaloneBrandedShortAction`. `BrandedShort.blogPostId` was already
nullable, so a standalone short is just one with no post. The per-post button on
the Distribute tab remains.

**USER MUST activate:** paste a HeyGen API key (Admin → API keys → *Media &
video*) from app.heygen.com → Settings → API, and hold HeyGen credits.
Pay-per-credit. Until then the button is replaced by a configure-key notice.

**Template asset** lives at `hyperframes/branded-short/` (editable via the
HyperFrames CLI: `npx hyperframes preview|check|render`). `next start` runs from
the repo root so the dir is on disk at render time — no bundling step. The
Google-Fonts `<link>` for IBM Plex is a known non-blocking `check` warning;
bundling woff2 locally is the deterministic-render hardening step if wanted.

---

## Analytics connections — GSC, GA4, YouTube OAuth (shipped 2026-07-25)

Groundwork for the intelligence/recommendation layer: **the data inputs land
before the analysis**, because a recommender without real telemetry would be an
LLM guessing — exactly what the truthfulness rules forbid.

**Audit finding:** two of the four sources already had UI and were simply
unconfigured — **Tavily/Serper** (Admin → API keys → Search) and **Unipile**
(Admin → Connections). Genuinely missing: **GSC, GA4, YouTube OAuth**.

**Auth model differs per platform on purpose:**

| Source | Mechanism | Why |
| --- | --- | --- |
| Search Console | Service account | Can grant an arbitrary principal access to a property |
| GA4 | Service account | Same — add the SA as a Viewer |
| YouTube | **OAuth** | Google will **not** let a service account touch a channel |

`src/lib/google/service-account.ts` generalizes the RS256-JWT → access-token
signer already proven in `storage/gdrive.ts` (dependency-free `node:crypto`),
scope-parameterized with a per-(SA, scope) token cache. `gdrive.ts` keeps its own
copy deliberately — load-bearing for storage, not worth churning.

`src/lib/youtube/oauth.ts` + `/api/oauth/youtube/callback` implement the real
consent flow. **The refresh token grants upload rights, so it is AES-GCM
encrypted** (`blog-crypto`, `TOKEN_ENCRYPTION_KEY`). `access_type=offline` +
`prompt=consent` is deliberate: without `prompt=consent`, a *second*
authorization returns no refresh token and the connection silently dies after an
hour. The callback only completes for a signed-in **ADMIN** whose workspace
matches the `state` we sent.

**Live probes, not status codes** (the Drive-storage pattern). GSC lists the
properties the SA can actually see and, on mismatch, names them — "not shared
with the service account" is the overwhelmingly common mistake. GA4 runs a real
28-day report (exercises the exact permission) and appends the precise fix on a
403. Input normalizing absorbs the usual paste errors: GSC domain
(`sc-domain:x.com`) vs URL-prefix properties, and GA4's numeric property id vs
the `G-XXXX` measurement id (the latter is rejected with an explanation rather
than silently stored).

Per-workspace throughout, with the service account **falling back to the
platform Drive SA** — one Google project can serve every workspace; the page
surfaces that address when it exists. New `/admin/analytics` page + nav entry.
No migration (`WorkspaceSetting` rows).

**Still user-owned:** granting the SA access in GSC/GA4, creating the YouTube
OAuth client, and pasting a search key. Until a source is connected, dependent
features report "no data" rather than guessing.

---

## Metrics spine (shipped 2026-07-25) — step 1 of the intelligence layer

Built **before** any recommendation engine on purpose: a recommender with no
telemetry is an LLM guessing, which the truthfulness rules forbid. Everything
here comes from the workspace's own content, so it needs **no credentials** and
works immediately.

`src/lib/metrics/index.ts` is the spine. The `Metric` shape carries `value`,
`sample`, `confidence`, `evidence` and `source` — so external inputs (GSC, GA4,
YouTube, social) land in the *same shape* later without collectors or UI
changing. That is what makes it a spine rather than a dashboard query.

**The honesty contract (enforced in the type):**
- **`value: null` means NO DATA — never 0.** The UI renders a dash plus the
  reason. A missing input must not read as a bad result.
- Every metric states its provenance in `evidence`, so a future recommendation
  can *cite its basis* instead of asserting.
- **Confidence is per KIND of number** — running against production caught this:
  a **count** is exact (we counted every row), including a true zero, so
  flagging "0 posts in progress" as low-confidence would be wrong. **Rates and
  medians** take confidence from sample size, where it genuinely applies.

**Collectors (all owned data):** pipeline funnel (ideas → approved → drafted →
published), idea conversion, draft→publish cycle time (median), weekly cadence +
trend (only claimed with enough on both sides), distribution follow-through
(published posts that actually got social/video), WIP by stage + stall
detection, AI generation volume, and **per-topic publish rates** — the "which
topics actually produce finished work" question the layer starts from.

**Performance metrics read `BlogSnapshot`**, which already carries exactly the
GSC/GA4 shape (impressions/clicks/position/sessions). When those connectors are
switched on they write the same rows and the collector does not change — only
`source` and the volume do.

**`MetricSnapshot` + migration `20260725010000`:** most metrics recompute live
(accurate, no drift), but point-in-time values (open WIP, stall counts) are
destroyed by time and trend detection needs real history. Rollup is idempotent
per (workspace, day, metric) and **records nulls too** — "we looked and there was
nothing" is a fact, and it stops a later gap being misread as a drop to zero.
Wired into the existing scheduler (hourly, `METRICS_ROLLUP_MIN`); one failing
workspace can't stop the rest.

New `/insights` page + nav (both the desktop rail and the mobile drawer register
the icon — they have separate registries).

_Verified against the live production DB before shipping:_ real idea counts, real
WIP with ages, real generation counts, and correct "—" for every absent input.

**Next (not started):** the recommendation engine on top — proposals that cite
`evidence` + `confidence`, surfaced in a review queue; then `auto` tweaks behind
an explicit allow-list (topic weighting, cadence, title variants), never
publishing or brand identity.

---

## Recommendation engine (shipped 2026-07-25) — step 2 of the intelligence layer

Reads the metrics spine, proposes changes, and can apply exactly one of them
autonomously — with the properties that make that acceptable.

**Deterministic, not LLM-authored.** The central decision. A model riffing over
numbers produces confident prose with no accountable derivation, which the
truthfulness rules forbid — and would produce mock garbage today anyway (the
Anthropic key is at $0). Every recommendation is a function of measured values,
so its rationale is checkable line by line, and it works right now.

**Every rule must** refuse to fire below its minimum sample, cite the exact
metrics used, and inherit the confidence of its **weakest** input. Thin data
produces *silence*, not a guess.

_Verified in both directions_ — silence alone could have meant "broken":
- **Live prod data:** 7 of 8 rules silent; only `connect_search_key` fires, and
  that's a certainty (no key set), not an inference.
- **Synthetic boundary fixtures:** 20% social follow-through at n=2 → silent,
  at n=9 → fires. Two topics at 100% vs 0% across 2 posts each → silent; 87% vs
  25% across 8 posts each → fires. Cadence −20% → silent, −45% → fires.

**Rules:** stalled content · declining cadence · missing social distribution ·
unconverted idea backlog · slow cycle time · best-converting topic · plus two
setup gaps (no analytics, no search key).

**Autonomy, deliberately narrow.** Applying is separate from generating and
gated **twice**: the action must be on the explicit `AUTO_APPLICABLE` allow-list
**and** the governing function's mode dial must be `auto`. Exactly **one** action
qualifies — `topic.raise_priority` — because it's the only genuinely safe lever:
it reorders which topics lead the discovery prompt (and win the 25-topic cut),
deletes nothing, and is undone by resetting the priority. `Topic.priority` added;
`discoverIdeasCore` orders by it. **Publishing and brand identity are not
reachable from the engine at all.** Rather than invent a riskier lever to look
more autonomous, the allow-list stays at one.

**Dedup that makes "dismiss" mean something:** generation is idempotent by
`fingerprint`, and dismissing applies a **14-day cooldown** — otherwise an hourly
sweep would resurrect it immediately. Counts are bucketed into the fingerprint so
a drift of one doesn't spawn a fresh row each hour.

Review queue on `/insights`: each proposal shows its **evidence inline**
(value, n, provenance), with apply / "I'll handle it" / dismiss-with-reason, and
a resolved list marking anything applied automatically. Migration
`20260725020000`.

**Not exercised:** the apply and auto-apply paths are code-verified only — no
action-carrying recommendation fires on current prod data (no Topics exist yet),
so there was nothing real to apply.

---

## Analytics sync — GSC/GA4 → BlogSnapshot (shipped 2026-07-25)

Closes a chain that was ~90% built and 0% functional. The connectors
authenticated and queried fine, and the metrics spine read `BlogSnapshot` — but
**nothing joined them**: `gscQuery`/`ga4RunReport` had zero callers and
`BlogSnapshot` was only written by the manual entry form. Connecting Search
Console would verify green and leave Insights' performance panels blank.

**Two decisions that carry the correctness:**

1. **One row per post per DAY.** `collectPerformance` **sums** snapshots across
   the window, so each row must describe a single day — storing a rolling
   "last 28 days" total per capture would multiply-count badly. Both APIs are
   therefore queried with a date dimension (`["page","date"]` /
   `["pagePath","date"]`), and GA4's `YYYYMMDD` is normalized to GSC's
   `YYYY-MM-DD` so the two merge into the same row.
2. **The sync only touches its own rows.** New `BlogSnapshot.source`
   (`manual|gsc|ga4|sync`, migration `20260725030000`). GSC revises recent days,
   so a refresh must overwrite — but it must never delete an operator's
   hand-entered snapshot. The delete is filtered to synced sources only.

**Matching:** posts are indexed by `publishedUrl`, **falling back to `slug`** —
without that fallback a freshly-connected property matches nothing, because a
post published outside the app (or before WordPress wiring) has a slug and no
stored URL. `urlKey()` normalizes to path-only, lowercased, no query/hash, no
trailing slash. _Verified with fixtures (8/8), including the case that matters:
a GSC absolute URL and a GA4 path for the same page produce the same key, so the
providers merge rather than duplicate._

**Cadence:** its own timer (`ANALYTICS_SYNC_MIN`, default **360 min**) rather
than riding the hourly metrics rollup — GSC lags ~2 days and is revised, so
polling hourly would burn quota re-fetching identical numbers. Lookback is 10
days, ending 2 days ago. Cheap no-op when no workspace has a connector.

**Honest reporting:** "connected" and "producing data" are different states, and
the sync says which. A live connector that matched nothing reports exactly that,
including how many other pages had traffic but match no post — the usual cause
being non-blog URLs or a slug mismatch. Manual **Sync now** on Admin → Analytics.

---

## Social: post editing + UTM link tagging (shipped 2026-07-25)

**Editing** closes the gap the original scheduler explicitly deferred. The module
had create / publishNow / cancel / delete / duplicate but **no edit** — fixing a
typo meant delete-and-recreate, losing the schedule, per-network variants and
media.

`SocialComposer` is **generalized to accept an existing post** (`ComposerInitial`)
rather than forking a second form: editing reuses the composer wholesale, so
char limits, per-network text variants and per-network images behave identically
*because they are the same component*. A parallel editor would have drifted.

Rules that keep it honest:
- **Editable only while `draft` | `scheduled`.** Once a target has posted the
  record is history and must keep saying what actually went out — duplicate
  instead.
- **Saving never sends.** In edit mode "Post now" is replaced by *keep as draft*
  / *schedule*; publishing stays a deliberate act from the queue, so an edit
  can't accidentally fire a post.
- Media is kept unless explicitly cleared or replaced (same per network).
- Deselecting an account deletes that target; re-adding recreates it.
- A target whose account has since been **disconnected is called out** on the
  edit page rather than silently dropped on save.
Plus `unscheduleSocialPostAction` (scheduled → draft, content intact).

**UTM link tagging** plugs into the analytics chain. Without it every click lands
in GA4 as undifferentiated referral traffic — the sync can say a page got
sessions, never that LinkedIn out-pulled X. Tagging is **per network**
(`utm_source=linkedin` vs `x`), per-workspace configurable, and applied **at
send, not compose**, so the stored text stays the author's and re-editing can
never accumulate parameters.

_Fixture-verified 6/6_ on the cases that would otherwise corrupt real post text:
trailing sentence punctuation is not swallowed (`Read https://x.com/p.` keeps its
full stop outside the URL), fragments survive with params inserted before them,
an **already-tagged link is left completely alone**, non-http schemes are
untouched, and disabled is an exact no-op. Anything unparseable keeps the
original text.

**Not exercised:** publishing still needs Unipile connected, so tagged text has
not gone to a live network.

---

## Social: month calendar with drag-to-reschedule (shipped 2026-07-25)

The drag-calendar the original scheduler deferred. **Calendar is now the default
view** for `/social`; the agenda stays one click away (`?view=agenda`).

**All date maths runs in the BROWSER, from ISO strings.** Deliberate, not
incidental: Railway runs UTC and the user doesn't, so a server-rendered grid
would place evening posts on the wrong day for anyone west of Greenwich. The
component buckets by **local** day.

**DnD is an enhancement, never the only path** — the rule `TaskBoard` already
established. Every chip also carries a date input, so keyboard and touch users
can reschedule without dragging.

Behaviour:
- Dragging to another day **preserves the time of day** (14:30 stays 14:30).
- Dragging an unscheduled **draft** from the tray onto a day schedules it at
  09:00 local. That tray is what makes this a working surface rather than a
  read-only month view.
- Moves are **optimistic**, and a server rejection **snaps the chip back** rather
  than leaving a lie on screen.
- Past days are dimmed and refuse drops (the sweep would fire them immediately).
  **The server re-checks the same rule** — the client guard is convenience, not
  the security boundary.

`rescheduleSocialPostAction` takes typed args (like `moveTaskAction`) so the
client can call it in a transition, is workspace-scoped, and refuses anything
that isn't `draft|scheduled` — a sent post can't be dragged into a lie.

**Not exercised:** with no Unipile accounts connected there are no posts to place
on the grid, so the DnD path is code-verified only.

## Social: posting schedule + queue slots (shipped 2026-07-25)

Buffer's core loop, and the natural follow-on from the calendar: define recurring
slots ("09:00 Mon–Fri"), then **"Add to queue"** drops a post into the next free
one. The common case stops needing a date picker at all.

### The timezone problem, and why it shapes the schema

A slot is stored as **wall clock** — `weekday` (0–6, `Date#getDay()`) plus
`minute` past local midnight — never as an instant. Two reasons, both load-bearing:

1. **"09:00 every Tuesday" must stay 09:00 across a DST change.** Storing an
   instant and adding 7 days drifts by an hour twice a year.
2. **Railway runs in UTC and the user doesn't.** The server's own
   `new Date(y, m, d, 9)` is simply the wrong answer, off by the user's offset.

So the schedule needs an anchor: **`WorkspaceSetting social:timezone`** (IANA).
Unset falls back to UTC, and the editor says so in amber rather than pretending —
`resolveTimeZone()` reports `configured` separately precisely so that a workspace
that *deliberately* picked UTC isn't nagged. The zone can't be auto-detected
server-side, so `PostingSchedule` reads the browser's
`Intl.DateTimeFormat().resolvedOptions().timeZone`, offers it, and makes saving
it an explicit act.

**`src/lib/social/slots.ts` is the only place allowed to convert wall clock to an
instant.** `zonedTimeToUtc()` samples the zone's offset via
`Intl.DateTimeFormat` `formatToParts` and runs **two passes** — the first offset
guess can be taken from the wrong side of a DST boundary, the second re-samples
at the guess and corrects it. Uses `hourCycle: "h23"`, not `hour12: false`: the
latter emits hour `"24"` on some ICU builds, which silently shifts the day.

This is the **mirror image** of the calendar's rule, and the pair should be read
together: **resolution** maths runs on the server (which knows the *workspace's*
zone), **display** maths runs in the browser (which knows the *viewer's* zone).
Neither may ever use the server's own local zone. Free slots are therefore
resolved server-side and handed to `SocialCalendar` as ISO strings, which buckets
them by local day exactly as it already does posts.

### Behaviour

- **Model `PostingSlot`** (migration `20260725040000_posting_slots`), unique on
  `[workspaceId, weekday, minute]` — a duplicate would mean two slots claiming
  one instant, which the queue counts as one.
- **A slot is "taken"** if any `scheduled|publishing` post sits in that minute,
  however it got there — queued, dragged, or typed by hand. Minute granularity,
  so a hand-typed 09:00:30 doesn't block the 09:00 slot.
- **Slots can be paused** rather than deleted. Pausing does **not** unschedule
  posts already placed in that slot — they were scheduled, and silently
  retracting them would misrepresent what's going out.
- **`claimNextFreeSlot(wsId, excludePostId?)`** returns `no-slots` or `full`
  rather than inventing a time. `excludePostId` lets a post being re-queued
  ignore the slot it already holds instead of being bumped down the line.
- **"Queue all drafts"** fills free slots oldest-draft-first and reports partial
  success honestly ("Queued 6. 3 didn't fit — add more slots") rather than
  refusing the whole batch.
- **Editing the schedule is ADMIN** (it changes when *everyone's* posts go out,
  so it sits with the other workspace config); **using the queue is EDITOR**,
  like every other way of scheduling.
- **Horizon is 120 days.** Beyond that the queue reports full.
- Calendar renders free slots as **dashed ghost chips**; dropping onto one takes
  that slot's *exact* time (the day cell underneath would only give the post's
  existing time, or 09:00). Ghost drop is an **enhancement** — the accessible
  path to the identical result is the **Queue** button on every unsent post.

### Fixed in passing (same bug class, now that a zone exists)

Server-rendered times on `/social` and the edit page were formatted with
`toLocaleString()` — i.e. **Railway's UTC clock**, not the reader's. The agenda's
day grouping, `PostCard`'s times and the edit page's "Scheduled for…" line now
pass `timeZone`. `ComposerInitial.scheduledAt` (a pre-formatted local string
built on the server) became **`scheduledAtIso`**, converted to a
`datetime-local` value in the browser — the edit form was pre-filling the wrong
wall clock for any non-UTC user.

### Verification honesty

- The timezone maths is the risky part and is **proven by 45 fixtures**: fixed
  offsets (London/New York/Kolkata/Sydney, both hemispheres' DST directions),
  both UK transitions *and* the US ones that fall on different dates, the
  **skipped** hour (resolves past the jump, doesn't throw) and the **ambiguous**
  hour (lands on one of the two real instants), local-vs-UTC weekday selection
  (a Sydney Monday slot at 22:00Z Monday correctly offers *next* Monday), and a
  weekly slot holding 09:00 across fall-back.
- `tsc --noEmit` clean, `npm run build` compiles.
- **The server path IS verified against the production DB** (2026-07-25, 21/21),
  by a throwaway probe that created slots + one scheduled post in Demo Workspace
  and deleted everything in a `finally` (cleanup confirmed: 0 slots, 0 `[TEST]`
  posts, timezone setting restored to unset). It proved: the timezone setting
  resolves and reports `configured`; Monday-first ordering; the unique
  constraint rejects a duplicate slot (P2002); free slots are ascending, future,
  and land on exactly the stored wall clock (`Mon 09:00 | Mon 15:00 | Wed 09:00 |
  Mon 09:00` in Europe/London); a claim takes the first free slot and the next
  claim **skips the occupied one**; `excludePostId` frees the post's own slot
  again; **pausing a slot removes it from the queue without unscheduling or
  moving the post already in it**; an all-paused schedule returns `no-slots`
  rather than a made-up time; and **workspace isolation holds** (LSI Media saw
  none of Demo Workspace's slots).
- **NOT verified:** the UI. The Browser pane opened a **signed-out** session and
  Claude cannot type credentials, so no page was exercised on prod — the
  schedule editor, the composer's "Add to queue" radio, the Queue buttons and
  the ghost-slot drag are code-verified only. The composer radio additionally
  needs a connected account to appear at all, so the **Unipile blocker** still
  gates that half.
- **Concurrency:** two simultaneous queue requests could claim the same slot
  (read-then-write, no lock). Consistent with the existing single-replica
  assumption already documented for the sweeps; a second replica would need the
  same Redis lock those need.

## Social: week view for the calendar (shipped 2026-07-25)

Month answers *"what does my coverage look like"*; week answers *"what goes out
when"*. So week is a **TIME GRID** (day columns × hour rows), not a denser month
— that is what earns it a place. A month cell can only place a post on a **day**;
a week cell places it at an **hour**, and dropping into one sets the time.

- **Month / Week is client-side state**, not a route change: switching framing
  shouldn't cost a round trip or discard an in-flight optimistic move. (The
  agenda toggle stays a `?view=` link — it's a different page section.)
- **One `cursor` anchor date, two framings.** Month reads its month, week reads
  the Monday-start week containing it; prev/next steps by the unit in view.
- **Drops snap to the half hour**, computed from where the pointer sits in the
  cell (`halfFor`) — matching how calendars behave. The cell shows the exact
  time it will land on while you hover, because a snap you can't see is a
  surprise. Exact-minute precision stays available: drop onto a **ghost slot**,
  or type into the chip's own control.
- **The chip's control is the always-available path, and it changes with the
  view**: month and the drafts tray get a `date` input, the week grid gets
  `datetime-local`. Otherwise week view would add a capability (setting a time)
  that keyboard and touch users couldn't reach — which would break the
  `TaskBoard` rule rather than merely bend it.
- **The hour window opens 07:00–20:00 and WIDENS to fit whatever is scheduled**,
  so a 06:00 post is never hidden by a default. A footnote says which window is
  showing and that nothing is hidden; **All 24h** overrides it for scheduling
  into the quiet hours. Widening is scoped to the visible week.
- **Times are locale-formatted through one helper (`timeLabel`)** — gutter,
  chips, ghost slots and the drop hint. A hard-coded 24h gutter put "15:00" next
  to a "03:00 PM" chip in the same cell; caught in verification.
- The week range label repeats the month on both sides on purpose: collapsing it
  reads fine in day-first locales but gives "20 – Jul 26, 2026" in month-first
  ones. Also caught in verification.
- **Seven columns + a gutter can't compress onto a phone**, so the grid keeps its
  width and scrolls inside its own container — the page body never scrolls
  sideways.

### Verification

Exercised in a real browser against a **throwaway fixture harness** (a temporary
unauthenticated route, deleted afterwards — the prod session is signed out and
Claude cannot type credentials). Confirmed: Monday-first headers `Mon20…Sun26`;
the window opening at 06:00 because of the early post while next week's 22:15
post correctly did **not** widen it; 105 cells = 15 hours × 7 days; locale
consistency across gutter/chips/ghosts; the range label; **half-hour snapping
(upper half → 01:00 PM, lower half → 01:30 PM)**; the drop reaching
`rescheduleSocialPostAction`; "All 24h" giving 24 rows 12:00 AM–11:00 PM and
hiding the window note; at 375px the grid scrolling internally (1008px inner vs
325px visible) with **no horizontal body scroll**; and month view unaffected (31
cells, `date` inputs only, the August post excluded).

**Automation caveat worth remembering:** `getComputedStyle` reads are **stale for
pre-existing nodes** in the browser-automation context — a control mutation
(setting an `<h1>` background) also failed to read back. The cell highlight
therefore looked broken and is not: a **clone** of the hovered cell computed to
`rgb(229,72,47)` / `rgb(253,231,225)` (accent + accent-soft). Verify styling on
freshly-created or cloned nodes, not mutated existing ones. This is the third
time an automation artifact has masqueraded as an app bug — see also §0i.

**Not verified:** the literal pointer-drag gesture (CDP drag remains unreliable;
synthetic drag events exercise the same handlers), and anything on production —
the queue and calendar still need a signed-in session and a connected Unipile
account.

## Social performance pullback (shipped 2026-07-26)

The social half of what the analytics sync does for the blog. Until now
`/social` could say a post went out but never what it did, and the metrics
spine measured a distribution channel it couldn't see. `MetricSource` already
had `"social"` reserved for this.

### The storage rule — deliberately NOT the blog's

`BlogSnapshot` rows are **per-day**, because GSC/GA4 are queried with a date
dimension, so `collectPerformance` **sums** them. Social APIs report
**cumulative lifetime totals** — "this post has 412 likes" as of the moment you
ask. Summing those across days would multiply-count by roughly the number of
times we polled (a post polled daily for a week would report ~7× its real
engagement).

So `SocialSnapshot` stores the cumulative reading and aggregates
**latest-per-target, then sums across targets**. `latestPerTarget()` in
`src/lib/social/performance.ts` is the only place that collapses it — anything
else that reaches for `db.socialSnapshot` directly is a bug waiting to happen.
`@@unique([targetId, capturedAt])` makes a re-poll on the same day a refresh
rather than an append, which is what keeps "latest" unambiguous.

**Deltas were considered and rejected:** they need an unbroken chain of prior
snapshots, so one missed sync silently corrupts the series, whereas a
cumulative reading is self-describing and re-derivable at any time.

**A consequence stated rather than hidden:** a lifetime counter cannot answer
*"engagement earned in the last 30 days"*, only *"engagement to date on posts
sent in the last 30 days"*. The metrics are scoped by **send date** and every
evidence string says exactly that. Under the blog's per-day heading the same
number would mean something different.

### The unverifiable part, handled as such

Unipile's post-statistics endpoint **and payload shape could not be verified** —
there is no connected account on this deployment, so no real response was ever
seen. `getPostViaUnipile` was written from the shape of the posting endpoint
(`/api/v1/posts`, `account_id`, `X-API-KEY`).

Hard-coding one guessed shape would fail **silently** — the worst outcome for a
metrics feed, because "no engagement" and "we didn't understand the reply" would
look identical. Instead `parseSocialStats` (`src/lib/social/stats.ts`):

- accepts the plausible spellings each network/API version uses
  (`impression_count` / `impressionCount` / `views` / `reach` …), normalised by
  lowercasing and stripping separators;
- descends only into **known container keys** (`statistics`, `public_metrics`,
  `insights`, …). A blind recursive walk would happily read
  `author.followers.count` as `likes`, and a wrong number is worse than a null;
- refuses values that only look numeric — `"1.2K"` is **not** read as 1.2,
  negatives and booleans are rejected;
- reports both what it **matched** (provenance) and which numeric fields it did
  **not** recognise. A shape mismatch therefore surfaces as an actionable
  message naming the exact fields to add to `ALIASES`, instead of writing nulls
  forever;
- keeps the spine's contract: unknown → `null`, a genuine zero → `0`. Those are
  different facts and the UI renders them differently.

A 404/405 comes back as `null` rather than throwing, so one wrong guess about
the path can't take down the sweep.

### Wiring

- Model `SocialSnapshot`, migration `20260726010000_social_snapshot`,
  `ON DELETE CASCADE` from `SocialPostTarget`.
- `collectSocialPerformance` adds `social_impressions`, `social_engagement`,
  `social_engagement_rate`, `social_clicks`. The rate is computed **only over
  targets reporting both halves** — mixing a network that reports impressions
  with one that doesn't would understate it. The empty state distinguishes
  "nothing was posted" from "posted but nothing pulled back", because those call
  for completely different actions.
- Insights gains a **Social performance** section plus a **by-network** table
  (the split UTM tagging exists to make possible). A dash there is a fact: the
  network didn't report that figure.
- **Rides the existing analytics cadence** (360 min) rather than taking a fifth
  timer — same job, and every extra timer is another thing that double-fires the
  day a second replica appears. It sits in its **own `try`** so a Unipile outage
  can't stop the GSC/GA4 half from having run.
- Manual **"Pull engagement"** button on `/social`, which reports the outcome
  verbatim — including the "polled N, read nothing usable" diagnostic.
- Sequential polling, capped at 120 targets/run, 30-day lookback (engagement is
  mostly earned early; after that polling just spends rate limit).

### Verification

- **50 fixtures** on the two things that would silently corrupt every social
  number: the mapper (four plausible network shapes, real-zero-vs-unknown,
  `"1.2K"`/negative/boolean rejection, the diagnostic output, top-level winning
  over nested, and *not* descending into unknown containers) and the aggregation
  (three cumulative readings collapsing to the latest **not** the sum, unsorted
  input, summing across targets, null-not-Infinity rates, provider-casing).
- **21 assertions against the production DB** (Demo Workspace, seeded and fully
  cleaned up): the no-data path returning nulls with a reason; latest-per-target
  against real rows (1000, not 2300); cross-target sums; the P2002 unique guard
  and upsert-refresh; workspace isolation (LSI Media saw none of it); the
  unconfigured-Unipile skip; and `ON DELETE CASCADE`.
- `tsc --noEmit` clean, build compiles, migration applied on prod.

**NOT verified — and this is the important caveat:** no real Unipile call has
ever been made. The endpoint path, the response shape, and therefore whether
`ALIASES` matches anything at all are **unconfirmed**. The design assumes it
will be wrong on first contact and makes that visible; expect the first live
pull to report unrecognised field names, and add them to `ALIASES`. Nothing
about engagement numbers on Insights should be trusted until that has happened.

## Social: Unipile → Zernio, and Redis-locked schedulers (shipped 2026-07-26)

### Why the swap

Unipile had dropped networks this product needs — Facebook and Twitter/X among
them. Zernio covers **fifteen**: linkedin, twitter, facebook, instagram,
threads, bluesky, tiktok, youtube, pinterest, reddit, googlebusiness, telegram,
snapchat, whatsapp, discord.

### ⚠ Unipile is NOT gone — it is the EMAIL path

**Do not delete `src/lib/unipile/`.** Zernio has no email channel (its channels
are social posts, DMs, SMS, calls, ads and WhatsApp), and Railway blocks
outbound SMTP, so a Unipile-connected mailbox over HTTPS is still the only way
real mail leaves this host. Removing it would silently break invitations,
verification, password resets and notifications — they would fall back to SMTP,
time out, and land on the mock. The client's social half was deleted; the header
comment says exactly why the rest stays. Product-owner decision, 2026-07-26.

### What Zernio's model gives us

- **`profile` is a tenant boundary**, so it maps 1:1 onto a workspace
  (`Workspace.zernioProfileId`, created lazily by `ensureZernioProfile`). The
  profile NAME is `ws_<workspaceId>` because Zernio requires names unique per
  team and two customers called "Acme" would collide; the display name goes in
  `description`.
- **`account.connected` carries `profileId` directly.** Unipile's mapping had to
  be smuggled through the hosted-auth `name` field with *no reconcile path* if a
  webhook was missed. Accounts are now listable by profile at any time, so
  `syncZernioAccounts()` can rebuild the local mirror from the source of truth —
  surfaced as **Refresh from Zernio**. Vanished accounts are marked
  `disconnected`, never deleted: SocialPostTarget rows reference them and
  history must stay readable.
- **Webhooks are signed** (`X-Zernio-Signature`, lowercase-hex HMAC-SHA256 of
  the RAW body — never a re-serialised object, which would change the digest).
  The route **fails closed without a secret**: an open endpoint that writes
  account rows is worth more to an attacker than a broken one is to us.
- **One publish call, not one per network.** `POST /posts` takes the whole
  fan-out in `platforms[]` and reports per-platform status back, which matches
  how `SocialPostTarget` already models things. Per-network overrides map onto
  `content` / `customMedia`.
- **Four guards against double-posting**, because a duplicate reaches a real
  audience: the scheduler lock, the atomic status claim, a **stable
  `x-request-id`** (derived from post id + exact targets + text, so a retry
  dedupes but a genuine edit-then-resend does not), and Zernio's content-hash
  409 — which we treat as SUCCESS, because it means the content is already out.

### The analytics guesswork is gone

`stats.ts` was ~150 lines of tolerant field-name guessing that existed *only*
because Unipile's statistics endpoint was undocumented and unverifiable. Zernio
documents its metric block exactly (`impressions, reach, likes, comments,
shares, saves, clicks, views, follows, engagementRate, lastUpdated`), so that
collapsed to a direct mapping. Kept from the old design: the honesty contract —
unknown stays `null`, a real zero stays `0`.

**Cumulative-lifetime storage was the right call and Zernio's docs confirm it**,
so `latestPerTarget()` stands unchanged. Snapshots gained `reach`, `saves` and
`views`, which Unipile simply never provided. Zernio's own `engagementRate` is
deliberately **not** stored: it is computed per platform against a denominator
we cannot see, so it cannot be summed or compared across networks — we derive
the rate from figures we hold.

### Migration note worth keeping

`SocialPostTarget.unipileAccountId` → `accountId` is a **hand-written
`RENAME COLUMN`**. What `prisma migrate diff` generated was `DROP` + `ADD COLUMN
NOT NULL` with no default — which fails outright on a non-empty table and
silently discards the ids on an empty one. The column is provider-neutral now so
a future swap will not need another rename.

## Redis-locked schedulers (shipped 2026-07-26)

All four sweeps (autopilot 30m, social 60s, metrics 60m, analytics 360m) now run
inside a distributed lock. Previously every timer fired on every replica, and
these are not harmless duplicates: **the social sweep publishes to a real
audience.**

- **Held for the WHOLE run**, not just long enough to elect a leader, and
  **per-sweep** so a slow autopilot cannot block the 60-second social tick.
- Acquire is `SET key token NX PX ttl` — atomic by construction. Release is a
  **Lua compare-and-delete**, so a holder whose lock already expired can never
  delete the lock a different replica has since taken. That check-then-act has
  to be atomic on the server.
- A **heartbeat** at ttl/3 extends it while work runs, which lets the TTL stay
  short: a killed replica frees the lock in `ttl`, not in however long the job
  might have taken.
- **Unreachable Redis fails CLOSED** (skips the tick). Failing open would
  double-run; for a periodic sweep, skipping is plainly safer.
- **Without `REDIS_URL` it degrades to an in-process mutex** — the previous
  behaviour, safe on one replica only — and warns loudly at boot rather than
  silently providing no protection.
- Honest limit: single-instance Redis, so a failover could briefly allow two
  holders. Redlock across independent nodes is the alternative and this
  deployment has one Redis; the social publisher's per-post atomic claim is a
  second net.
- `src/lib/redis.ts` is a hand-rolled RESP2 client (same call as `gdrive.ts` /
  `heygen-cloud.ts`): six commands, one in flight at a time, every call
  timeout-bounded. Explicitly not a general client — swap for `ioredis` if it
  ever needs more.

### Build fix that came with it

`instrumentation.ts` is compiled for the **Edge** runtime as well as Node, so
the lock's static import put `node:net` / `node:tls` / `node:crypto` into a
graph with no implementation for them — three `Ecmascript file had an error`
reports on every build (harmless, since `register()` returns early off-Node, but
noise that hides real errors). Everything touching Node built-ins is now
imported **dynamically, after the runtime guard**. Same for
`checkLockBackend()` in the connections page.

### Verification

- **42 fixtures against the real Railway Redis**: RESP round-trips including a
  200KB bulk string and 25 concurrent commands keeping order; **ten simultaneous
  contenders with exactly one entering the critical section**; release-on-throw;
  compare-and-delete refusing to free another holder's token; TTL expiry;
  heartbeat holding a 5s body past its TTL; fail-closed on an unreachable
  server; and the in-process fallback still being mutually exclusive.
- **70 fixtures on the Zernio side**: signature verification (valid, wrong
  secret, tampered body, single-character forgery, truncated, body-specific),
  API-key shape, all fifteen platform slugs, legacy Unipile spellings still
  resolving so pre-migration history renders, char limits, the metric mapping
  (real zero vs unknown, negatives/NaN refused, engagementRate not stored), and
  the cumulative aggregation surviving the swap.
- **Live on production**: migration `20260726020000_zernio_social` applied, and
  the boot log reads **`[lock] sweep locking backend: redis`** — the lock is
  active against the real Redis, not the fallback. `REDIS_URL` is wired to the
  Redis service over Railway's private network.

**NOT verified:** no real Zernio API call has been made — there is no key yet.
Every shape comes from Zernio's published docs rather than guesswork, but first
contact may still differ; the probe-on-save is what will surface that
immediately. The UI is also unverified (prod session signed out).

## Create a workspace (shipped 2026-07-26)

There was no way to make a workspace from inside the app: they only appeared at
signup (one per new user) or by invitation. Worse, `requireMembership()` has
always redirected members-of-nothing to `/onboarding/workspace` — **a route that
did not exist**, so a user whose last membership was revoked hit a 404 they
could not escape.

**The page must stay OUTSIDE the `(app)` route group.** That group's layout
calls `getActiveChannel()` → `requireMembership()`, so a page inside it would
send a zero-membership user straight back to its own URL, for ever. It sits on
the bare root layout next to `/invitations/[token]`, which is outside for the
same reason. There is a comment on the file saying so, because "tidying" it into
`(app)` would silently restore the loop.

Entry point is **Settings → Workspaces**; the creator becomes ADMIN, matching
signup.

## Elsie — the in-app guide (shipped 2026-07-26)

An interactive walkthrough: spotlight, arrow, popup, stepped with Back/Next/Done,
toggled by a single button in the top bar. Named for LSI Media — "L-S-I" said
aloud is *el-ess-eye*.

### She is contextual, not a slideshow

The decision the whole feature hangs on. `relevantSteps(setupState, done)`
filters setup steps against what the workspace has **actually** done — AI key,
Zernio key, connected profiles, mailbox, topics, posting slots — so nobody is
walked through work they finished last week. A tour that tells you to do things
you have already done trains you to close it, and then it can't help with the
things you haven't.

Consequences that fall out of that:

- Setup steps run **before** the tour. Being shown the social composer is noise
  if you have no account to post from.
- `setup-accounts` ("connect your profiles") is withheld until Zernio itself is
  configured — otherwise it's advice you can't act on.
- Platform-only setup (AI key, Zernio key, mailbox) is hidden from non-operators
  entirely, and the button's badge counts **only** steps the viewer can act on.
  Badging someone with work they're not allowed to do is just nagging.

`src/lib/guide/steps.ts` is pure data plus one selector, deliberately — the
sequencing is the part worth testing and it shouldn't need a browser.

### Anchors are `data-elsie`, never CSS selectors

A selector like `.btn:nth-child(3)` breaks the first time someone reorders a
toolbar, and breaks **silently** — the tour points confidently at the wrong
thing, which is worse than not pointing at all. `LeftRailNav` emits
`data-elsie="nav/<href>"` generically, so adding a module makes it targetable
without touching the engine.

A step whose anchor is genuinely absent is **skipped after ~2.5s**, not left
pointing at nothing: a page can legitimately not render a control (no accounts,
no permission).

### ⚠ Not requestAnimationFrame

Measuring after `scrollIntoView` used to be `requestAnimationFrame`. **Browsers
suspend rAF in a hidden or background tab**, so anyone who switched away
mid-tour came back to a guide stuck with no popup — the overlay hung in exactly
that state during verification. It now measures immediately and corrects with a
`setTimeout` once layout settles. Don't reintroduce rAF here.

### Other choices

- The spotlight is ONE element with a `0 0 0 9999px` box-shadow, not four divs
  forming a mask — it can't develop seams and it animates as one.
- The overlay **swallows clicks**. Letting you click through means navigating
  away mid-step and stranding the highlight; steps that want action carry an
  explicit CTA link instead.
- **Esc and X mean "not now"** and leave her enabled; the top-bar button is the
  real on/off. Turning her back **on clears progress**, so she replays instead
  of appearing to do nothing.
- State lives in cookies (`meyousocial_elsie`, `_done`), matching theme and
  content size — a per-person UI preference read in the layout on every render
  without a query. Two cookies, so a malformed progress list still leaves the
  toggle working. **Absent = on**, which is what makes her show up for new users
  at all; only an explicit "off" disables her.
- Placement prefers below → above → right → left → centred, whichever genuinely
  fits, then clamps to the viewport. A popup half off the edge is worse than one
  slightly off-centre from its target.

### Verification

- **31 fixtures** on selection: fresh install offers all five setup steps in
  order and badges 5; a configured workspace offers none; each condition flipped
  independently drops exactly its own step; operator-only steps hidden from a
  member (badge drops to 2); progress removes steps; and every step is
  well-formed (unique ids, off-route anchors declare their route, absolute CTAs).
- **Browser-verified against a throwaway harness**: auto-open on the welcome
  card, spotlight wrapping its target, popup placed below (`top` = spotlight
  bottom + gap) then **flipping above** when there's no room, clamped to
  `left: 8` at both the left edge and 375px wide with **no body scroll**, the
  CTA and `setup` badge, a **missing anchor skipped** to the next step, `Done`
  on the last step, the complete off→on cycle clearing progress, and Esc closing
  without disabling.

**Note on reach:** she defaults on for *everyone*, not only brand-new accounts,
so existing users meet her once until they dismiss or switch her off. That is
the requested behaviour; the alternative (auto-open only when setup is
outstanding) is a one-line change in the layout if it proves annoying.

**Not verified:** the real app's own anchors on production (signed-out session).
The harness exercised the engine, not the fifteen real `data-elsie` targets.
