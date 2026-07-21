# CreateUp — complete app brief (for merging into another app)

_Written 2026-07-19. This is a **committed, public-safe** overview: architecture, full feature
set, data model, and the seams to integrate against. Operational secrets (Railway IDs, the admin
lockout, credentials) live in the local, git-ignored `SESSION-HANDOFF.md` — copy that separately._

**New session, other computer, goal = combine CreateUp with another app?** Start by reading, in
order: this file, then `CLAUDE.md` (conventions, auto-loaded), then `DECISIONS.md`. Then §9 below
("Merging into another app") is the actual playbook.

---

## 1. What CreateUp is

An AI-powered **YouTube research & scripting platform**. A creator connects a channel, and the app
trains a "voice" + "audience" model from it, surfaces competitor/outlier intelligence, generates
video ideas, drafts scripts in an AI canvas, makes thumbnails, and runs a production pipeline
(tasks, calendar, assets) through to publish-ready exports. Multi-tenant (workspaces + roles).

- **Repo:** `https://github.com/igrant9679/CreateUp` (**public**) — `git clone https://github.com/igrant9679/CreateUp.git`
- **Branch:** `main` (pushing auto-deploys to Railway)
- **Hosting:** Railway (Nixpacks). Postgres plugin. Build `prisma generate && next build`;
  start `prisma migrate deploy && db:seed && next start`.
- **No billing/payments anywhere** — deliberate (spec + `DECISIONS.md §5`). Access = roles + optional soft limits.

---

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router), React 19, TypeScript 5 — ⚠ see `AGENTS.md`: breaking changes vs. older Next; read `node_modules/next/dist/docs/` before framework work |
| Styling | Tailwind v4 (`@tailwindcss/postcss`), IBM Plex Sans/Mono via `next/font`, light/dark via `data-theme` + CSS hue tokens |
| DB / ORM | PostgreSQL + **Prisma 6** (dev and prod both Postgres) |
| Auth | **Auth.js v5** (`next-auth@5-beta`), JWT sessions, `@auth/prisma-adapter`, Credentials + optional Google SSO, `trustHost: true` |
| Data mutations | **Server Actions** (`src/app/actions/*`) — not a REST layer |
| Streaming | SSE for script/agent generation (`api/scripts/[id]/generate`, `.../agent/[runId]`) |
| Background jobs | in-memory queue (`src/lib/jobs`), Redis/BullMQ-ready via `JOB_BACKEND=redis` |
| Validation | Zod v4 |
| Exports | `docx`, `pdfkit` |
| Key libs | `@anthropic-ai/sdk`, `@google/genai`, `nodemailer`, `bcryptjs`, `nanoid`, `lucide-react` |

---

## 3. Feature set (complete)

Grouped by area. Each maps to routes under `src/app/(app)/` and actions under `src/app/actions/`.

**Auth & tenancy**
- Email/password signup+signin, email verification, password reset (`(auth)/signin|signup|forgot|reset`).
- Optional Google SSO (`ENABLE_GOOGLE_SSO`).
- Workspaces (tenants), Memberships with **roles ADMIN/EDITOR/VIEWER**, email invitations
  (`invitations/[token]`). First user matching `BOOTSTRAP_ADMIN_EMAIL` becomes admin.
- ACL enforced in `src/lib/acl.ts` (`requireUser/requireMembership/requireRole/requireChannel`) — **workspace-scoped**.

**Onboarding** (`onboarding/channel/new`, `.../[id]`) — multi-step: connect a YouTube channel (or
describe a new one), pick competitors, state differentiation. Kicks off background jobs that train
Voice, Audience, and seed 10 starter Ideas. Resilient: writes baseline rows first, LLM enriches
after, so the UI never hangs.

**Channels** (`channels`, `channels/[id]/*`)
- Per-channel: **Voice** profiles (train from videos, borrow a voice, writing samples, multiple
  profiles), **Audience** avatar, **Competitors**, **Channel Memory** (durable facts injected into
  every generation), **Templates** (clone from a video), **Research** library (starred, persists),
  **Scripts** list, **Submissions** queue (public form → ideas), **Settings** (relink YouTube,
  business/brand toggle, thumbnail brand assets, soft limits).

**Intel** (`intel`, `intel/channels/[id]`, `intel/videos/[id]`, `intel/bookmarks`)
- Search competitor channels/videos with advanced token syntax (`subs:>100k velocity:>5 …`),
  outlier scoring, similar-channel discovery, chat-with-entity, auto-indexing, bookmarks,
  curated dashboard modules.

**Ideas** (`ideas`, `channels/[id]/ideas`, `.../[ideaId]`) — AI idea generation from outliers +
own-channel performance; idea detail → "write to canvas" (spins up a Script).

**Chat / Ideation** (`chat`, `chat/[id]`) — channel-scoped chat conditioned on voice+audience;
attach URLs/files as context; quick web search + deep research; "turn this into a script";
Prompt Library (`components/PromptLibrary.tsx`).

**Scripts / Canvas** (`scripts`, `scripts/[id]`, `.../builder`, `.../publish`)
- AI **canvas**: chat pane + Plan/Script tabs, streaming generation, autosave, version history,
  Humanize, highlight-and-improve, model picker per script, template selection, word-count/duration.
- **Script Builder** — guided 10-step workflow (research depth → title → thumbnail → hook →
  key points → section-by-section draft → polish → export → metadata).
- **Publish** — title/description/tags/hooks/shotlist generation, YouTube chapter markers.
- **Export** — Word (.docx) / PDF (`api/scripts/[id]/export`). **Teleprompter** (`teleprompter/[id]`).

**Thumbnails** (`thumbnails`, `thumbnails/[id]`) — thumbnail studio, CTR scoring, history (image
provider is mock-swappable).

**Agent Mode** (`api/scripts/[id]/agent/[runId]`, `lib/jobs/agent.ts`) — automated pipeline that
researches → outlines → drafts → (optional) produces, emits progress via SSE, emails on completion,
can promote a script into a tracked Content Project.

**Production** (`production/*`) — Board, Writer's Room, Film Queue, Edit Bay, **Tasks** (kanban),
**Calendar**, **Assets** + shot-list import, **Swipes** (clip URLs/thumbnails), **Wiki** (SOPs →
project checklists), Content Projects with performance rollups + repurposing.

**Admin** (`admin/*`) — Users & roles, Workspace settings, Soft limits, Usage dashboard, Channels
management, **API keys** (`admin/api-keys`), **Email/SMTP** (`admin/email`). API keys + SMTP are
settable in-app (DB-backed) without touching env vars.

**Public API v1** (`api/v1`, `api/v1/{channels,ideas,scripts}`) — minimal read surface + one POST,
so external clients / MCP servers can drive the app.

**Other**: Dashboard (`dashboard`), searchable Help/FAQ (`help`, `lib/help.ts`), user Settings +
theme (`settings`), file uploads (`api/uploads`), PWA (`icon.tsx`/`apple-icon.tsx`/`manifest.ts`).

Route totals: 62 page files, 8 API route groups, 28 server-action modules.

---

## 4. Data model (Prisma — 36 models)

`prisma/schema.prisma`. Note: JSON-shaped fields are stored as **serialized `String`** (helpers in
`src/lib/db/json.ts`) for portability — not native JSON columns.

- **Tenancy/auth:** `Workspace`, `Setting` (generic key/value — backs in-app API keys + SMTP),
  `User`, `Membership` (+ `Role` enum), `Invitation`, `Account`, `Session`, `VerificationToken`.
- **Channel domain:** `Channel`, `VoiceProfile`, `AudienceAvatar`, `Competitor`, `ChannelMemoryEntry`.
- **Intelligence:** `IntelChannel`, `IntelVideo`, `Bookmark`, `ChannelStat`.
- **Content:** `Idea`, `Chat`, `ChatMessage`, `ChatContext`, `Script`, `ScriptVersion`, `Template`,
  `ResearchSource`, `Thumbnail`, `AgentRun`.
- **Production:** `ContentProject`, `ProjectAssignee`, `Task`, `Asset`, `AssetLink`, `Swipe`, `WikiDoc`.
- **Growth/ops:** `UsageLog`, `AudienceSubmission`.

---

## 5. Integration seams (the important part for merging)

Every external dependency sits behind a **provider interface with a mock default**, selected by a
`USE_MOCK_*` flag. This is the app's core extensibility pattern — a merging app plugs in here.

| Seam | File | Interface | Real impls | Flag |
| --- | --- | --- | --- | --- |
| LLM | `src/lib/llm/` | `LLMProvider` (`complete`/`stream`) via router `llm.*` | Anthropic, Google Gemini (OpenAI/DeepSeek/xAI/Moonshot/MiniMax stubbed) | `USE_MOCK_LLM` |
| Email | `src/lib/email/` | `EmailProvider` | nodemailer SMTP | `USE_MOCK_EMAIL` |
| Images | `src/lib/images/` | `ImageProvider` | mock only (OpenAI/Stability/Replicate/Imagen planned) | `USE_MOCK_IMAGES` |
| YouTube | `src/lib/youtube/` | `YouTubeProvider` | mock only (YouTube Data API planned) | `USE_MOCK_YOUTUBE` |
| Search | `src/lib/search/` | `SearchProvider` | mock only (Tavily/Brave/SerpApi/Bing planned) | `USE_MOCK_SEARCH` |
| Storage | `src/lib/storage/` | `StorageProvider` | local FS, S3/R2, Google Drive | `STORAGE_BACKEND` |
| Jobs | `src/lib/jobs/` | `JobQueue` | in-memory, Redis-ready | `JOB_BACKEND` |

**LLM specifics** (`src/lib/llm/`): the router `llm.complete()/stream()` is provider-agnostic. Real
providers are wrapped with a **45s timeout + transparent fallback to mock** on any error — so a
missing/broken/out-of-credit key degrades output instead of erroring. Keys resolve **DB `Setting`
first, env var fallback** (`llm/keys.ts`, 30s cache). Model registry in `llm/models.ts`.

**Config** (`src/lib/env.ts`): one typed accessor over `process.env`; all `USE_MOCK_*` default **on**,
so the app boots and demos fully with **zero real keys**.

---

## 6. Auth & access model (know this before merging users)

- Auth.js v5, **JWT** sessions, Credentials (bcrypt) + optional Google SSO. `trustHost: true`.
- Identity: `User` ⇄ `Membership` ⇄ `Workspace`, role per membership (ADMIN/EDITOR/VIEWER).
- All data access is **workspace-scoped** through `src/lib/acl.ts`. Nothing is global; a user only
  sees data for workspaces they're an active member of.
- Public URL is **request-derived** (`src/lib/public-url.ts` + `trustHost`) so custom domains need
  no env changes.

---

## 7. Config / env (`.env.example` has all ~65 vars)

Buckets: DB (`DATABASE_URL`) · auth (`AUTH_SECRET`, `AUTH_URL`, Google SSO) · bootstrap
(`BOOTSTRAP_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) · LLM keys (7 providers) + `DEFAULT_LLM_MODEL` ·
YouTube · email/SMTP · images · search · storage (local/S3/GDrive) · jobs/redis · soft limits ·
and the `USE_MOCK_*` switches. **Boots fully mocked with none of them set.**

---

## 8. Run / build / deploy

```powershell
npm install
npx prisma generate
npm run dev            # http://localhost:3000  (fully mocked, no keys needed)
# before any commit:
npx tsc --noEmit       # clean
npm run build          # clean
```
Scripts: `dev build start lint db:push db:migrate db:reset db:seed db:studio`. Windows PATH gotcha:
prefix `$env:Path = "C:\Program Files\nodejs;" + $env:Path` or call `node node_modules\typescript\bin\tsc`.
Deploy = push to `main`; Railway runs migrate + seed + start. Details + infra IDs: `SESSION-HANDOFF.md`.

---

## 9. Merging into another app — the playbook

Pick the model that fits the other app, then hand the new session this file + the other app's brief.

**A. Absorb the other app into CreateUp** (CreateUp is the shell)
- New top-level feature → add a route group under `src/app/(app)/…`, an entry in the nav
  (`src/components/LeftRailNav.tsx` **and** `MobileNav.tsx` — both read a shared `isNavActive()`),
  server actions under `src/app/actions/…`, and Prisma models (then a migration).
- Reuse tenancy: gate everything through `requireMembership`/`requireRole` so the other app's data
  is workspace-scoped like the rest. Store per-tenant config in the generic `Setting` table.
- Reuse the LLM router (`llm.complete/stream`) and the mock-fallback pattern for any AI the other
  app needs — don't add a second LLM client.

**B. Absorb CreateUp into the other app** (other app is the shell)
- CreateUp has **no REST CRUD layer** — mutations are Server Actions, so you can't drive it purely
  over HTTP. Options: (1) lift the `src/lib/*` provider seams + Prisma models into the other app and
  re-mount the routes; or (2) run CreateUp as a service and integrate via the read-only **`api/v1`**
  surface (extend it with the POST endpoints you need).
- If the other app is also Next.js App Router + Prisma, merging schemas + `src/lib` is the least
  friction. If it's a different stack, prefer the service + `api/v1` route.

**C. Side-by-side under one shell / SSO**
- Share auth: both behind Auth.js with a shared `AUTH_SECRET` and user table, link accounts by email.
- Share the DB or federate; keep each app's tables namespaced.

**Watch-outs when merging**
- **JSON-as-String**: CreateUp's JSON fields are serialized strings — don't assume native JSON columns.
- **No billing by design** — if the other app has payments, keep them out of CreateUp's surfaces or
  revisit `DECISIONS.md §5` explicitly.
- **Colored UI** must use the `--<hue>` / `-soft` / `-on` CSS tokens (dark mode derives via
  `color-mix`); raw hex won't adapt.
- **Next 16** — verify framework APIs against `node_modules/next/dist/docs/`, not memory.
- **Mock fallback hides failures** — "it works" doesn't prove a real key is wired; check logs for
  `falling back to mock`.
- More than one Claude session has committed to `main` — `git log` before assuming state.

---

## 10. Open items (carried from `SESSION-HANDOFF.md`)

- **Admin account lockout** — unresolved. Recovery: `railway run node scripts/set-admin-password.mjs
  'newpass'`, or the `RESET_ADMIN=true` seed flag. Full detail in `SESSION-HANDOFF.md §4`.
- **Anthropic key at $0 credits** — generations fall back to mock; add a Gemini key at
  `/admin/api-keys` or top up billing.
- **Rotate `AUTH_SECRET`** — a test cookie was once committed (removed in `8daa5b7`).
