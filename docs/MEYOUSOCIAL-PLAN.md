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

1. **7 Motifs system (FR-2)** — editable versioned style directives, single or
   weighted multi-select per post, per-channel mapping for social variants,
   workspace defaults by tier/audience; wired into EVERY generation (drafts,
   social, video packaging). Replaces the 4-option tone select. Plus brand kit
   (colors/fonts/logo/footer credit), H1–H6 px/margin heading spec, editable
   featured/OG image dimensions.
2. **Asset pipeline + gate (FR-8)** — featured + branded OG image required
   before publish (workspace dimensions, validation, crop/resize warning),
   image briefs, optional AI generation via ImageProvider behind human review,
   alt-text (exists).
3. **Publish fidelity (FR-7/FR-11/FR-6)** — Squirrly/RankMath/Yoast field
   mapping, canonical + OG fields, slug conventions, external-link suggestion,
   publisher notes; WP categories/tags/author, featured-image upload,
   draft-in-WP handoff, heading-spec styling; LSI house template
   (question-reframe intro, mindset-shift takeaway, CTA) + track-based length
   defaults (cornerstone 2000+, supporting 1200–1800).
4. **SME profiles (FR-3)** + idea-engine depth (FR-5: priority scoring,
   auto-tagging, dedupe-vs-published, merge, kanban board, seasonal hooks).
5. **Notifications (FR-16 in-app + email via existing SMTP)** + check depth
   (FR-9 descriptive-link-text/labels; FR-10 anti-slop tone/filler checks,
   reviewer assignment, inline comments).
6. **Larger / externally gated:** FR-15 content audit (site crawl + slop
   detection), FR-18 design-system rendering (Gutenberg/Fusion mapping),
   GSC/GA4 connectors, Uniple, Nifty, Microsoft SSO, MFA.

Conventions unchanged: dual-push (origin + deploy), tsc exit-checked + build
before push, offline migrations via `prisma migrate diff`, mock-first seams,
truthfulness rules on every new generation surface.
