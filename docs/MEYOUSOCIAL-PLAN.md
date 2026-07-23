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
5. **Notifications (FR-16 in-app + email via existing SMTP)** + check depth
   (FR-9 descriptive-link-text/labels; FR-10 anti-slop tone/filler checks,
   reviewer assignment, inline comments).
6. **Larger / externally gated:** FR-15 content audit (site crawl + slop
   detection), FR-18 design-system rendering (Gutenberg/Fusion mapping),
   GSC/GA4 connectors, Uniple, Nifty, Microsoft SSO, MFA.

Conventions unchanged: dual-push (origin + deploy), tsc exit-checked + build
before push, offline migrations via `prisma migrate diff`, mock-first seams,
truthfulness rules on every new generation surface.
