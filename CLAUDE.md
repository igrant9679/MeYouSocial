@AGENTS.md

# Project state — handoff for a fresh session

_Last updated: 2026-05-31._

CreateUp is an AI-powered YouTube research & scripting platform. Next.js 16 (App Router) +
React 19 + TypeScript + Tailwind v4, Prisma 6 + PostgreSQL, Auth.js v5 (JWT). Hosted on
**Railway**, source on **GitHub** (`igrant9679/CreateUp`). Pushing to `main` auto-deploys;
Railway runs `prisma migrate deploy` on boot.

## How to work here
- Read `AGENTS.md` (above): this is Next.js 16 — check `node_modules/next/dist/docs/` before
  writing framework code; don't trust training-data assumptions.
- **Windows machine.** Node is at `C:\Program Files\nodejs`. In PowerShell, `npx`/`node` may not
  be on PATH — prefix with `$env:Path = "C:\Program Files\nodejs;" + $env:Path` or call
  `node node_modules\typescript\bin\tsc --noEmit` directly. `python`/`python3` and `uv`/`uvx`
  are installed (real Python 3.12.10).
- Before committing: `tsc --noEmit` clean, then `npm run build`. Commit + push only when asked.
- No billing/credits/payments anywhere in the app (per spec). Access = roles + optional soft limits.

## Architecture quick map
- **LLM router** `src/lib/llm/` — provider-agnostic `llm.complete()/stream()`. Real providers
  (anthropic, google) are wrapped with a 45s timeout + transparent **fallback to mock** on any
  error, so the app never breaks when a key is missing/out of credits. Keys resolved by
  `src/lib/llm/keys.ts`: **DB Setting row first, env var fallback**, 30s cache.
- **Email** `src/lib/email/` — nodemailer SMTP. Config resolved DB-first (`email:smtp` Setting),
  then `SMTP_*` env, then mock. Set via the admin UI.
- **Public URL** `src/lib/public-url.ts` — `getPublicUrl()` derives the origin from the request
  host (falls back to `env.APP_URL` in background jobs). Auth.js has `trustHost: true`. This means
  **custom domains need no env changes**.
- **Settings storage** — generic `Setting` table (key/value). Backs in-app API keys + SMTP config.
- **Icons/PWA** — `src/app/icon.tsx`, `apple-icon.tsx`, `manifest.ts` generate favicon, iOS
  home-screen icon, and web manifest.
- **Left nav** `src/components/LeftRailNav.tsx` (client) — labeled sidebar (≥md, 240px; icon +
  always-visible label, colored active row). Active route via the shared `isNavActive()` (also used
  by `MobileNav`); channel-scoped `ideas`/`scripts` URLs light up those entries, not Channels.
- **Theming/colors** `src/app/globals.css` — light/dark via `data-theme` on `<html>`. Per-hue tokens:
  `--<hue>` (solid, e.g. nav chips with white text), `--<hue>-soft` (chip background), `--<hue>-on`
  (chip foreground). Dark mode auto-derives `-soft`/`-on` via `color-mix`, so **use these tokens for
  colored chips/badges instead of raw hex** or they won't adapt. `.btn.primary` uses `--accent-strong`
  for AA contrast. Fonts come from next/font via `--font-plex-sans/-mono`.
- **Shared UI helpers** `src/components/`: `SubmitButton` (form pending spinner via `useFormStatus`),
  `MobileNav` (hamburger drawer <md), `ChannelSwitcher` (auto-submitting channel select),
  `ValidatedInput` (on-blur per-field validation via native constraints; use for form inputs).

## Admin surfaces (sidebar → Admin)
Users · Workspace · Soft limits · Usage · Channels · **API keys** (`/admin/api-keys`) ·
**Email/SMTP** (`/admin/email`). API keys + SMTP can be set in-app without touching Railway.

## Open items / things the user still owns
- **Anthropic key has $0 credits** — generations fall back to mock until the user tops up billing
  OR sets a **Gemini** key (`/admin/api-keys` → Google) and switches a channel's model to
  `gemini-2.5-pro` / `gemini-2.5-flash`.
- **Rotate `AUTH_SECRET`** — a `.test-cookies.txt` with an encrypted session token was once
  committed then removed (commit `8daa5b7`). Not exploitable without the secret, but rotating is
  best practice. (Will sign everyone out once.)
- ~~Seed prints the admin password to the deploy log~~ — **done (2026-05-31):** only the public
  built-in default is echoed for local dev; a configured `SEED_ADMIN_PASSWORD` is never logged.
- **Custom domain:** if the user adds one in Railway → Settings → Networking, add the Google OAuth
  redirect URI in Google Cloud Console if SSO is enabled. No code/env change needed otherwise.

## Machine-level (not part of this repo)
User-level Claude skills are installed at `C:\Users\Admin\.claude\skills\`: `notebooklm-research`,
`watch`, and the ui-ux suite (`ui-ux-pro-max`, `banner-design`, `brand`, `design`,
`design-system`, `slides`, `ui-styling`). The `notebooklm` MCP server is registered at user scope;
it needs a one-time `uvx notebooklm login` (Google sign-in) the user must do.
