# SETUP — what you need to provide

The app boots and is fully demoable with **zero** real keys (all `USE_MOCK_*` flags are on). When you want to turn a feature from mock to real, you'll need the values below. Provide them by editing `.env` (local) or by pasting into Railway → Variables (production).

## Railway gotchas (from first deploy)

If you ever rebuild the Railway project from scratch, two non-obvious things bit us on the first attempt:

1. **Node version.** Railway/Nixpacks defaults to Node 18; Next.js 16 needs ≥20.9. We pin `engines.node = ">=20.11.0"` in `package.json` so the right version is auto-selected.
2. **devDependencies.** With `NODE_ENV=production` in Variables, npm skips devDependencies — but `@tailwindcss/postcss`, `tailwindcss`, `tsx`, `@types/*` are needed at build time. Set `NPM_CONFIG_PRODUCTION=false` in Railway Variables so devDeps install.
3. **Public domain port.** Next.js's `next start` listens on `PORT` (Railway sets it to `8080`). When you generate the public domain, set its target port to **8080** — not 3000.

## 0. Already set for you

- `BOOTSTRAP_ADMIN_EMAIL=idris.grant@communityforce.com` — first account to sign in with this email becomes the workspace Admin.
- `DATABASE_URL` — **you must set this for local dev.** Easiest: Railway → Postgres plugin → Variables tab → copy `DATABASE_PUBLIC_URL` into your local `.env`. On Railway itself, the internal `DATABASE_URL` is injected automatically — don't paste it into Railway Variables.
- `AUTH_SECRET` — placeholder in `.env`. Before deploying, run `openssl rand -base64 32` (or use any 32-byte random string) and put it in Railway Variables.

## 1. AI model provider keys (FR-MODEL-01)

Pick at least one — the rest can be added later. Models picker in the UI only shows providers with a key (or all of them in mock mode).

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `GOOGLE_GENAI_API_KEY` | aistudio.google.com/apikey |
| `DEEPSEEK_API_KEY` | platform.deepseek.com |
| `XAI_API_KEY` | console.x.ai |
| `MOONSHOT_API_KEY` | platform.moonshot.ai |
| `MINIMAX_API_KEY` | minimax.io |

Then set `USE_MOCK_LLM=false` and (optionally) `DEFAULT_LLM_MODEL` to one of: `claude-sonnet`, `gpt-4o`, `gemini-1.5-pro`, `deepseek-chat`, `grok-2`, `kimi-k1`, `minimax-abab`.

## 2. YouTube Data API (FR-INTEL, FR-ONB-04, FR-VOICE-01)

1. Google Cloud Console → create / select a project.
2. Enable "YouTube Data API v3".
3. Credentials → Create credentials → API key.
4. Paste into `YOUTUBE_API_KEY`, set `USE_MOCK_YOUTUBE=false`.

Transcript fetching uses youtube-transcript scraping by default — no key needed. If you want a paid service, set `TRANSCRIPT_PROVIDER` and `TRANSCRIPT_API_KEY`.

## 3. Google SSO (FR-AUTH-01)

1. Google Cloud Console → APIs & Services → Credentials → "Create credentials" → OAuth client ID → Web application.
2. **Authorized redirect URIs**: add
   - `http://localhost:3000/api/auth/callback/google` (local)
   - `https://<your-railway-domain>/api/auth/callback/google` (prod)
3. Copy client ID + secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Set `ENABLE_GOOGLE_SSO=true`.

## 4. Email (FR-AUTH-04 invitations, FR-AGENT-02 completion notices)

**Recommended: Resend** — easiest setup, free tier covers dev.

1. resend.com → API Keys → create.
2. Set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY=...`, `USE_MOCK_EMAIL=false`.
3. Verify a sending domain (or use Resend's `onboarding@resend.dev` while testing).

Alternatives: `postmark`, `ses`, `smtp` (then fill `SMTP_HOST/PORT/USER/PASS`).

## 5. Image generation (FR-THUMB, FR-AUD-03)

| `IMAGE_PROVIDER` | Key var | Notes |
|---|---|---|
| `openai` | `IMAGE_API_KEY` | DALL-E 3, gpt-image-1 |
| `stability` | `IMAGE_API_KEY` | Stable Diffusion |
| `replicate` | `IMAGE_API_KEY` | Many models |
| `google` | `IMAGE_API_KEY` | Imagen via Vertex |

Then `USE_MOCK_IMAGES=false`.

## 6. Web search (FR-CHAT-05/06)

| `SEARCH_PROVIDER` | Notes |
|---|---|
| `tavily` | Recommended for AI agents; free tier exists |
| `brave` | Brave Search API |
| `serpapi` | Google SERP scraping |
| `bing` | Bing Web Search |

Set `SEARCH_API_KEY`, `USE_MOCK_SEARCH=false`.

## 7. File storage

Default is `STORAGE_BACKEND=local` writing to `./.data/uploads`. **This will not persist on Railway** (containers are ephemeral). Pick one:

### Cloudflare R2 (recommended for Railway — S3-compatible, free egress)

```
STORAGE_BACKEND=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=createup
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

### AWS S3

Same as above, omit `S3_ENDPOINT`, set `S3_REGION=us-east-1` (or wherever).

### Google Drive

```
STORAGE_BACKEND=gdrive
GDRIVE_FOLDER_ID=<the Drive folder id from the URL>
GDRIVE_CLIENT_ID=...
GDRIVE_CLIENT_SECRET=...
GDRIVE_REFRESH_TOKEN=...
# OR
GOOGLE_SERVICE_ACCOUNT_JSON=/abs/path/to/service-account.json
```

## 8. Background jobs (FR-AGENT, FR-ONB-09)

Local dev uses in-memory queue. For production:

```
JOB_BACKEND=redis
REDIS_URL=redis://...
```

On Railway, add the Redis plugin and Railway will inject `REDIS_URL` automatically.

## 9. Optional video production (FR-AGENT-05)

Only when you turn on the production pipeline:

- `TTS_PROVIDER=elevenlabs` + `TTS_API_KEY`
- `AVATAR_PROVIDER=heygen` (or `did`) + `AVATAR_API_KEY`
- `RENDER_PROVIDER` + `RENDER_API_KEY`

Set `USE_MOCK_PRODUCTION=false`.

## 10. Observability (optional)

- `SENTRY_DSN` for error reporting.
- `LOG_LEVEL=debug|info|warn|error`.
- `RATE_LIMIT_PER_MINUTE` per-user chat/generation guard.
