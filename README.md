# MeYouSocial

AI-powered **blog & video content platform** — the merge of **Spark** (multi-tenant
blog/SEO pipeline: idea → grounded draft → SEO/WCAG gates → WordPress publish →
social → analytics) and **CreateUp** (YouTube research, scripting, thumbnails,
production pipeline) into one mostly-autonomous app.

**Read first:** `docs/MEYOUSOCIAL-PLAN.md` — locked merge decisions, the
three-mode autonomy dial (`manual` / `assisted` / `auto` per function), and the
phase plan. Conventions: `CLAUDE.md` + `AGENTS.md` (this is **Next.js 16** —
check `node_modules/next/dist/docs/` before framework work).

> Historical docs from the CreateUp parent (`BUILD_PLAN.md`, `DECISIONS.md`,
> `MERGE-BRIEF.md`, `CreateUp_Requirements.docx`, `CreateUp_Mockups.html`) are
> kept for reference — the design tokens and FR numbering come from there.

## Quick start

```powershell
# 1. Install deps
npm install

# 2. Prepare the database
npm run db:push
npm run db:seed

# 3. Run the dev server
npm run dev
```

Open <http://localhost:3000>. The app boots in **mock mode** — every external
integration (LLM, YouTube, images, search, email, storage) is faked. Flip the
corresponding `USE_MOCK_*` flag in `.env` and supply a key to turn each one real.

The first user to sign in matching `BOOTSTRAP_ADMIN_EMAIL` is promoted to Admin
automatically.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run prod build |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply Prisma schema to dev DB |
| `npm run db:migrate` | Generate + run a new migration |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |

## What to supply when you want to turn off the mocks

See `SETUP.md`. Short version:

- **LLM:** set `ANTHROPIC_API_KEY` (or another provider) + `USE_MOCK_LLM=false`.
- **YouTube:** `YOUTUBE_API_KEY` from Google Cloud Console.
- **Google SSO:** OAuth client ID/secret + register `${APP_URL}/api/auth/callback/google`.
- **Email:** SMTP via Admin → Email, or `SMTP_*` env vars.
- **Storage:** swap `STORAGE_BACKEND` to `s3` or `gdrive`.

## Deploy (Railway)

Repo: <https://github.com/igrant9679/MeYouSocial> (**private**)

Steps:

1. In Railway project → **+ New** → **Database** → **PostgreSQL**. Railway
   auto-injects `DATABASE_URL` into every service in the project.
2. **+ New** → **GitHub repo** → pick `igrant9679/MeYouSocial`.
3. In the service → **Variables**: paste the values from your local `.env`
   **except** `DATABASE_URL` (Railway sets it). Required at minimum:
   - `AUTH_SECRET` (run `openssl rand -base64 32`)
   - `APP_URL` and `AUTH_URL` (Railway assigns a domain on first deploy — set
     these to that URL, then redeploy)
   - `BOOTSTRAP_ADMIN_EMAIL` **and `SEED_ADMIN_PASSWORD`** (set both from day
     one — this is what caused the CreateUp admin lockout)
   - Leave every `USE_MOCK_*=true` to start.
4. First deploy runs automatically. Build = `npm ci && npx prisma generate &&
   npm run build`; start = `npx prisma migrate deploy && npm run start` (see
   `railway.json`). Migrations apply on every boot — safe because
   `migrate deploy` is idempotent.
5. (For the autonomy engine / Agent Mode) Add the **Redis** plugin and set
   `JOB_BACKEND=redis`.

## Docs

- `docs/MEYOUSOCIAL-PLAN.md` — the merge plan and phase roadmap (start here).
- `BUILD_PLAN.md` — the CreateUp parent's 172-FR checklist.
- `DECISIONS.md` — tech choices and deviations.
- `SETUP.md` — what *you* need to provide.
