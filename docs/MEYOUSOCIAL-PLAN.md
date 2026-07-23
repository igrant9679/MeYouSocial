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
