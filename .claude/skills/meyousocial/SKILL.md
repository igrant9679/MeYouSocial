---
name: meyousocial
description: "Operate, manage, verify and explain MeYouSocial Publisher (the product; MeYouSocial is the family brand) — the multi-tenant AI content engine (research → ideas → drafts → review → publish → distribute → measure). Use for any question or task about the app: what a page does, which dial to change, why an article is held, the daily/weekly/monthly routines, repeatable processes (publish an article, onboard a workspace, handle a held image or an unsourced claim, publish without WordPress), troubleshooting, and — for Claude working in the repo — the house rules, deploy flow and production verification recipes. Triggers: MeYouSocial, autopilot, Inbox, stage strip, Ideas board, Drafts, Review, Publish, Distribute, Measure, Settings, full autonomy, publish day, posting slots, Zernio, Intel, findings, citations, NEEDS SOURCE, HTML export, Elsie."
argument-hint: "[question | task | 'routine daily|weekly|monthly' | 'process <name>' | 'troubleshoot <symptom>']"
metadata:
  author: Idris Grant / Claude
  version: "1.0.0"
  app: MeYouSocial Publisher (Next.js 16, Prisma, Railway)
  updated: 2026-09-08
---

# MeYouSocial Publisher — the operator's skill

**MeYouSocial Publisher** is a content engine that runs mostly on its own, for several companies on one install. (MeYouSocial is the family brand for it and its sibling apps — renamed 2026-09-09; the names live in `src/lib/product.ts`; the API header `X-MeYouSocial-Token` and the Drive folder name are contracts and did not change.) It researches what is worth saying, drafts articles and social posts (with their images and SEO), holds everything at review gates, publishes to a website and to social networks on a schedule, and pulls the results back in. **A person's job is decisions, not production.**

This skill makes any Claude an expert operator of the app: as a *user* (what every page and dial does, the routines that get the most out of it) and, in §7, as the *engineer* who maintains it (repo rules, deploy, production verification). Read §1–§3 before answering anything about the app; jump to §5 for routines and processes; §6 for "why is X stuck".

---

## 1. The mental model

**One loop, six stages.** Research → Ideas → Drafts → Publish → Distribute → Measure. The left rail is that loop, in order, with **Inbox** above it (what needs a person, one card per item, the action on the card — reviewing happens here, not in a stage of its own; the Review stage folded into the Inbox on 2026-09-20) and **Setup** below it (Settings · Channels · Brand, admins only — the operator pages are tabs of Settings at their unchanged /admin/* URLs). **Assistant** and **Help** sit outside the loop. The assistant is also the **Ask dock** top-right on every page (Ctrl+/): it can do nearly everything a person can, asks when unsure, ranks the next moves on "what should I do next?", and proposes anything outward-facing before running it on a yes.

**The engine works while nobody is looking.** A 30-minute *autopilot sweep* discovers ideas, drafts approved ones, generates images and SEO, reviews its own work (a vision model looks at every AI image; live web search sources every flagged claim), advances what passes, publishes on the publish day, writes social posts, queues them into posting slots, recycles evergreen posts, and syncs engagement and analytics. Every one of those has a dial under **Settings**, and a master switch — **full autonomy** — that turns all of them on.

**Gates review as well as block.** Nothing AI-made reaches an audience until its required checks pass (meta title, meta description, slug, focus keyword, a body, alt text on every image, no unresolved `[NEEDS SOURCE]` markers, every citation verified, a branded Open Graph image — the lockup is COMPOSITED by `lib/images/lockup.ts` onto a text-free render, never painted by the model; `BlogImage.branded` is true only when that composite ran). Under full autonomy the app does that review work itself and only holds what it genuinely cannot fix: a claim no source supports, an image that keeps failing inspection, a provider outage. Those holds land in the Inbox.

**Silence means all clear.** If something urgent is waiting, the workspace's admins get one morning digest email. A quiet morning sends nothing. No email and a green Inbox = nothing to do.

**Never an invented number.** A dash means "not measured", never zero. Outlier ratios, best-time-to-post, analytics — all measured or absent.

**Roles.** ADMIN approves, publishes, sends and configures; EDITOR writes, drafts, answers and proposes; VIEWER reads. Setup is hidden from Editors. Publishing an article and approving a social post are always an admin's act.

**Workspaces.** One workspace = one company: its own keys, accounts, voice, content, slots and dials. The workspace switcher (top left) decides whose everything every page shows. Check it before acting.

---

## 2. The interface, page by page

### 2.1 The rail

| Entry | Purpose | Overview shows |
|---|---|---|
| Inbox `/inbox` | Landing page. Everything waiting on a person, then the pipeline beneath. | Cards: posts awaiting approval (Approve / Request changes, admin), questions only you can answer (answer inline; saved to the Experts profile, asked once), claims with no source (Verify URL / Drop the claim), images that need your eye (Approve / pick another), articles held at review (naming the failing check), invitations not accepted (with the join link). Then category conditions, the pipeline strip, coming up, engine feed, results, quick tiles, channels. |
| Assistant `/assistant` + the **Ask dock** (top-right, every page, Ctrl+/) | A chat that does nearly everything a person can — reads all of it (pipeline, Inbox, ideas, articles + checks, social, keywords, topics, outliers, connections, dials, results, reports, best time, live web, the guide) and acts (ideas, keywords, topics, drafts, scripts, SEO, images, findings, claims, image approval, advance, social draft/queue/schedule/send, publish / mark published / export, publish day, slots, timezone, weekly target, modes, full autonomy, pause, social dials, studio, invitations, roles, run the autopilot). Refuses only secrets, deleting a workspace/account, sending email. | Interactive: asks with tappable choices when ambiguous; `next_steps` ranks the moves; **confirm** tools (publish, send, queue, approve, override, settings, invite) are PROPOSED — "I'm about to: … Go ahead?" — and run on a yes (the proposal waits on the thread, `AssistantThread.pending`); admin-only tools refuse for an editor; every execution audited `assistant.tool_run`; steps shown under each reply; links to what it made. One conversation across pages (thread id in localStorage); the full page and the dock share it. **The Research chat is folded in (09-09)**: the system prompt carries the active channel's niche, audience, voice, memory and starred research (`lib/assistant/context.ts` `channelBrief`); tools `intel_channel`, `intel_video`, `analyze_youtube_video`, `read_web_page`, `list_research_sources`, `read_research_source`, `start_script`; Intel pages link "Ask about this channel / video" to `/assistant?q=…`; the composer has the prompt library (Ctrl+Shift+/) and a paperclip (upload → ResearchSource on the channel → "[attached: …]" in the message). |
| Research `/research` | Competitor intelligence — the on-ramp to all three formats. | Strong outliers (≥2× their channel's average) GROUPED BY TOPIC (keyword match, computed at render, labelled); a Topic with nothing indexed says so; Unmatched last. On every row, the Intel video page and every bookmarked video: a chooser — Article · Video (channel) · Social post — with the Topic pre-filled from the match and editable; the idea keeps `sourceVideoId`. Tabs: Intel · Bookmarks · Competitors (active channel). The old Chat tab is the assistant. |
| Ideas `/ideas` | **The one board** for article, video AND social ideas, in **Topic lanes** (since 2026-09-21, "Topics as the spine"). | One lane per active Topic (priority order; past eight they open collapsed), columns Discovered · Approved · Drafted, Rejected under a disclosure per lane, a **No topic yet** lane last holding every legacy idea with a one-click **Tag it**. Format chip on every card (Article / Video · channel / Post). Add form (Article / Video · channel / Social post, Topic), **Discover article ideas** (emptiest Topics first, or one Topic), Generate 10 video ideas, Recompute priorities. Filters: All / Articles / Video · channel / Social. Tabs: **Topics** (`/ideas/topics`: add, edit, phrases, priority, archive, delete, Discover per Topic, each Topic's ledger — ideas by format · to triage · made · out — and **Suggested from your keywords**: clusters that are not Topics yet, Add as Topic / Discard; per-Topic page `/ideas/topics/<id>`) · Keywords (each cluster header has **Make it a Topic**) · Experts. |
| Drafts `/drafts` | Everything being written or rendered, in all three formats. | Articles drafting / in review, **Social posts** (drafts not yet in a slot, with Topic and source — article / research / an idea / composed by hand — and **Queue it**), scripts, video renders. Tabs: Articles · (Scripts · Thumbnails · Videos · Production when the video studio is shown). |
| Publish `/publish` | What's at final approval, when it goes, what went live — and the two gates in front of it. | Rows with Publish now (admin, WordPress connected), **Download HTML** (always), **Mark as published** (admin, no WordPress). Tabs: Approvals · Audit · Website · Blog calendar. |
| Distribute `/distribute` | The social queue and accounts. | Accounts with health (coloured by real trouble), this stage's Needs you / Worth knowing, the queue in the workspace's zone, recently published (failed legs called out). Tabs: Compose · Calendar · Engage. |
| Measure `/measure` | Measured numbers only. | Impressions/clicks chart, tracked posts with position deltas. Tabs: Reports · Insights · **Topics** (`/measure/topics`: one row per Topic, columns per format — articles out/made · position · clicks, video renders · views · retention, social out/made · engagement · impressions, ideas waiting — every cell measured or a dash with the reason; YouTube numbers are matched to a Topic BY KEYWORD, shown as `kw`, because nothing links a render to the uploaded video) · Blog analytics · Blog report · Social performance · YouTube audit (`/youtube`: the own channel over 7/28/90/365 days from the YouTube Analytics API — tiles vs the previous window, daily views, findings with evidence, every video in the window with views/hr, "Ask for a plan" and per-video "fix it →" into the assistant; cached a day, Refresh pulls live; impressions/CTR/revenue are not in the API-as-connected and the page says so). |
| Settings `/setup` | Every dial, under the question it answers. | Overview sentences per question. Tabs: People · Automation · Schedule · Connections. Plus the **Video studio** switch. |
| Channels `/channels` | YouTube channels (the video side's unit). | Per channel: Home, Audience, Voice, Templates, Memory, Submissions, Settings (its own sub-nav; the stage strip takes over on Scripts / Competitors / Research). Switcher on the channel header when there is more than one. |
| Brand `/brand` | Identity: colours, company info, personas, keywords, connected accounts. **Topics moved to Ideas → Topics on 2026-09-21**; Brand keeps a one-line pointer (`#topics`). | Strip tabs: Tone & motifs (`/blog/brand`, the 7 Motifs + brand kit + image specs + AI brand context) · Organization (`/blog/organization`). |
| Admin `/admin` | Operator pages. | Users (same panel as Settings → People), Workspace (branding), Soft limits, Usage, Channels, API keys, Connections, Analytics, Email. |
| Help `/help` | Help Center: role paths, FAQ by category, shortcuts, the owner's guide `/help/guide`. | |

**The stage strip.** On every page a stage owns, a sticky bar shows `STAGE · Overview · tabs`, current one lit, with **count badges**: red = a person must act (articles held at review, posts awaiting approval, open audit items, unseen replies), muted = news (scheduled posts, discovered ideas, articles at final approval, pending invitations). Badges show only above zero. On a phone the strip is one scrolling row.

**Old URLs still work.** `/dashboard` → Inbox; `/review` → Inbox; `/blog/board` → `/blog?view=list`; `/admin` → Settings → People; `/blog/ideas` and `/channels/<id>/ideas` → the Ideas board (filtered); `/blog/automation` → Settings → Automation; `/social/settings` → Settings → Schedule; `/social` → Distribute. Every module page (`/blog`, `/intel`, `/social/calendar` …) kept its URL and is a tab of its stage.

### 2.2 Every route (what it is for)

- `/inbox` landing · `/assistant`, `/assistant/[id]` threads · `/notifications` bell · `/settings` **personal** (profile, theme, content size — not the workspace's Settings).
- Research: `/intel` (index channels by @handle or keyword; outliers + views/hour — `IntelVideo.viewsPerHour`, fixed at index time, `vph:>N` search filter, channel page sort), `/intel/channels/[id]`, `/intel/videos/[id]` (embed, transcript, chat-with-video), `/intel/bookmarks` (`/chat` → the assistant since 09-09; `/chat/<id>` remains only for a script's canvas chat), `/chat/[id]`, `/channels/[id]/competitors`, `/channels/[id]/research`.
- Ideas: `/ideas` board · `/blog/keywords` (keyword strategy; drives idea priority; volume / trend / competition / CPC from a search-data provider — DataForSEO or Keywords Everywhere key under Settings → Keys, `lib/search-data`; dash when none, never invented) · `/blog/experts`, `/blog/experts/[id]` (SME profiles the writing quotes; knowledge answers bank here) · `/channels/[id]/ideas/[ideaId]` (video idea detail).
- Drafts: `/blog` (ONE Articles page — `?view=board` default, `?view=list` for the dense list; `/blog/board` redirects here) · `/blog/[id]` (editor: body, SEO, images, citations, versions, **Optimize** tab = findings) · `/scripts`, `/scripts/new`, `/scripts/[id]`, `/scripts/[id]/builder`, `/scripts/[id]/publish`, `/teleprompter/[id]` · `/thumbnails`, `/thumbnails/[id]` · `/videos`, `/videos/[id]` (Veo renders from a storyboard; stored copy preferred) · `/production` (Writer's Room → Film Queue → Edit Bay → Calendar; assets, swipes, tasks, wiki, projects).
- Publish: `/social/approvals` · `/blog/audit` (content audit: refresh / merge / retire recommendations) · `/website` (WordPress connection, theme template) · `/blog/calendar` · `/blog/[id]/export` (self-contained HTML; `?fragment=1` = body only).
- Distribute: `/social/compose` · `/social/calendar` (slot grid; drag; queue) · `/social/engage` (comments, DMs, reviews — the 24-hour DM window) · `/social/[id]/edit`.
- Measure: `/reports`, `/reports/[key]`, `/reports/[key]/pdf` · `/insights` · `/blog/analytics` · `/blog/report` · `/social/performance` · `/youtube` (channel audit, `lib/youtube/analytics.ts`).
- Setup: `/setup` with People · Automation · Schedule · Connections, and for admins Keys (`/admin/api-keys`) · Analytics · Email · Workspace (`/admin/settings`) · Usage — the operator pages are Settings TABS now and kept their `/admin/*` URLs (`/admin` itself redirects to `/setup/people`) · `/channels`, `/channels/[id]/…` · `/brand`, `/blog/brand`, `/blog/organization`.
- Onboarding: `/onboarding/channel/new` (wizard: niche, style, YouTube link, competitors, differentiation → voice + audience + 10 starter ideas in the background).

### 2.3 Statuses (the vocabulary)

- **Article** (`BlogPost.status`): `drafting` → `draft_review` → `final_approval` → `published`. Auto-review runs on `draft_review`; auto-advance moves it when every required check passes; the publish-day gate moves `final_approval` → `published` (WordPress) or a person marks it published after an HTML export.
- **Article idea** (`BlogIdea.status`): `discovered` → `approved` → `drafted` (or `rejected`, `merged`). Only `approved` ideas are drafted; approval is a human act by design.
- **Video idea** (`Idea.status`): `new` (Discovered) · `approved` (Approved) · `in_progress` / `scripted` (Drafted) · `archived` (Rejected). The board shows the three tables in one vocabulary; three tables remain beneath on purpose (`lib/ideas-board.ts` says why).
- **Social idea** (`SocialIdea.status`, since 2026-09-21): `discovered` → `approved` → `drafted` (or `rejected`); `source` `manual` / `discovered` / `research` / `article`; `socialPostId` set when drafted. The engine's own ideas take the `ideas:social_gate`; a person's wait for that person. `hook` is the post in one line (≤ 240).
- **Image** (`BlogImage.status`): `pending` → `approved`; roles `featured` and `og`; sources `ai` / `upload` / `url`.
- **Citation** (`BlogCitation`): `verified` false/true with `sourceUrl`; each corresponds to a `[NEEDS SOURCE]` marker in the body.
- **Social post**: `draft` → `scheduled` → `posted` / `partial` / `failed`; `approval` `pending` / `approved` / changes requested when the approval workflow is on. One post fans out to one target per network, each with its own status.
- **Function modes** (governance): `manual` (AI acts only on clicks) · `assisted` (AI runs, queues at a human checkpoint) · `auto` (unattended) — for ideation, blog drafting, social, publishing.
- **Finding** (`BlogFinding`): kinds `mechanical` (auto-applied, ≤3 per cycle), `knowledge` (a question only the author can answer), `strategic` (a decision); status `open` / `applied` / `answered` / `dismissed`.

---

## 3. The engine, dial by dial

### 3.1 The autopilot sweep (every 30 minutes; silent when idle)

Per workspace, in order: **ideation** runs PER TOPIC × FORMAT (`lib/ideation.ts`): the emptiest Topic × article cells (fewer than two open ideas for that Topic) are filled first, two a sweep, and every idea it writes carries its Topic; a workspace with no Topics falls back to one untagged workspace-wide run when its pool is below three · **drafting** consumes `approved` article ideas up to the weekly article target (rolling seven days) and the daily AI budget (20 generations) · **social, in three steps** (since 2026-09-21): (a) ideation — a published article's social angles become social IDEAS (one per angle, source `article`, the article's Topic), and the emptiest Topic × social cells are topped up where `social:autogen` is on; (b) the gate — `ideas:social_gate` `auto` (default; what full autonomy sets) approves the engine's own discovered ideas in the same sweep, `human` leaves them on the board and the Inbox counts them; ideas a person added (manual, Research) always wait for that person; (c) drafting — one approved social idea per sweep becomes a post, written exactly as autogen wrote it (240 chars, non-media targets, auto-image, claimed slot or pending hold under `social:require_approval`, campaign) up to `social:autogen_weekly`, so the feed's volume and cadence did not change; the post carries the idea's Topic and links back to it. `social:source = rotation` is the operator-only ROLLBACK to the pre-spine generator (Topic picked in turn, per-network `SocialVariant` rows on publish) · **storyboards** for published articles where the mode allows · **auto-review** on every `draft_review` article: fill empty SEO (never overwrites hand-tuned metadata), render missing images, have a vision model look at every pending AI image (approve or regenerate; after two rejections stop spending and tell a person; an unchanged rejected render is judged once), source every `[NEEDS SOURCE]` claim through live search with an LLM judge that demands real support (topical overlap is not support; an unsourceable claim is retried at most once a day), generate findings once and apply the mechanical ones · **auto-advance** `draft_review` → `final_approval` when every required check passes · **publish** `final_approval` → `published` on the publish day in the posting timezone (a date set by hand on a post is always honoured) · **social housekeeping**: recycle evergreen posts, sync engagement and account health. A cycle writes an `autopilot.cycle` audit row only when it did something; an idle sweep leaves no trace, by design.

**Full autonomy** (`autonomy:full`): one switch that sets ideation, drafting, social and publishing to `auto` and turns auto-queue on, snapshotting the previous dials so switching off restores them exactly. Confirmed by typing AUTONOMOUS. Under it, the app presses the review buttons a person would; it does not lower what they check.

**Global pause** (`autopilot:paused` via governance): the emergency brake — blocks every AI action, manual clicks included.

### 3.2 Settings, by question (`/setup`)

| Question | Tab | Dials |
|---|---|---|
| Who can do what | People | Members and roles, invitations (with the join link, since a workspace without a mailbox only logs the email), **require approval** for social posts (`social:require_approval`). Publishing an article is a role, not a dial. |
| What runs by itself | Automation | Full autonomy; global pause; autopilot status + Run cycle now; **weekly article target** (`autopilot:weekly_articles`, empty = no cap) and **publish day** (`autopilot:publish_day`, 0–6, empty = any day); **SEO with every draft** (`blog:auto_seo`, default on); social auto-dials — queue on approval (`social:autoqueue`), evergreen auto-fill (`social:evergreen_fill`), auto-image (`social:auto_image`, default on), auto-generate posts n/week (`social:autogen`, `social:autogen_weekly`, default 5) with an optional campaign; **function modes**. |
| When things go out | Schedule | Posting slots and timezone (`social:timezone`; slots are wall-clock weekday + minute, so 09:00 survives DST), measured best time to post (silent below its sample size), link tagging (`social:utm_*`), campaigns. The article publish day is set under Automation. |
| Keys and connections | Connections | A status table: LLM keys, live search (Tavily/Serper — needed for citation sourcing), images (gpt-image-1 / gemini image), video (Veo), voice (ElevenLabs), branded shorts (HeyGen), YouTube Data API (platform-managed), channels, social accounts (Zernio), mailbox (Unipile — the only route out for email; SMTP is blocked on the host), WordPress, analytics (Search Console + GA4), storage. Each row links to the page that fixes it; the forms stay there. |
| Brand and voice | Brand | Company info, the seven Motifs (versioned prompt rows; a weighted blend per post), brand kit and image specs, AI brand context (differentiators, products, documents — never AI-generated), experts. Topics are NOT here any more — Ideas → Topics. |

**Video studio** (`studio:enabled`, absent = on): Scripts, Thumbnails, Videos and Production show under Drafts only when a YouTube channel exists and the switch is on. Turning it off hides tabs and controls; nothing is deleted; direct URLs still work. Packaging an article into a short or a render is not the studio and is never gated.

### 3.3 The gates (`runBlogChecks`)

Required: meta title ≤ 60 · meta description ≤ 155 · slug (lowercase, hyphenated) · focus keyword in title or meta title · a body · alt text on every image · no unresolved `[NEEDS SOURCE]` markers · every citation verified · a branded Open Graph image attached (1200×630) and a featured image. Optional (shown, never blocking): keyword in body, heading levels don't skip, length near target, readability ≥ 50, no generic filler, grounded in an expert profile. The Inbox's "Articles held" card names the failing required check. A person outranks the checks: clearing acts advance the article immediately, and an admin can "Advance anyway" (recorded: who, when, why; honoured by the sweep and by publishing).

### 3.4 What still stops a post, deliberately

A claim no real source backs (the gate working) · an image that keeps failing inspection · mock search or a mock LLM (nothing is ever verified on a stand-in's word) · a missing vision key (nothing is approved unseen) · no WordPress connection (articles park at final approval; use Download HTML + Mark as published) · a workspace with no working AI key (the assistant refuses rather than guesses; drafts are refused when the reply came from the mock). The assistant never runs a confirm tool without the person's yes in the same thread.

### 3.5 Social specifics

Zernio publishes to 15 networks; use this app's Connect buttons, not Zernio's dashboard. **Slots** are the recurring send times; a queued post claims the next free slot in its category (own → general → any, so nothing strands). **Approval workflow**: pending or changes-requested posts cannot be sent, scheduled, queued or dragged — enforced server-side. **Queue on approval** makes approving the last human act. **Evergreen** clones a posted source into free slots after its cooldown (opt-in; clones are never themselves evergreen). **Campaigns** carry their own `utm_campaign`. **Engage**: Facebook and Instagram DMs can only be answered within 24 hours of the person's message. Token-expiry notes are shown but never alerted on (Zernio refreshes them); an account is "in trouble" only on Zernio's own verdict or the network's status.

### 3.6 Research specifics

Intel indexes public YouTube metadata (shared across workspaces; quota is per Cloud project). An **outlier** is a video's views divided by its channel's average: ≥5× exceptional, ≥2× strong, ≥1× average — measured or a dash, never estimated. "Make it an idea" on the Research overview turns an outlier into an article idea; on the video side, video ideas keep their link to the competitor video. Chat-with-video answers from the transcript.

### 3.7 Notifications, digest, Elsie

Notifications (bell) carry holds and failures with a link. The **digest** (`digest:enabled`, `digest:hour`) sends one morning email to admins only when something needs them, through the workspace's mailbox. Everyone can turn it off for themselves under Notifications. **Elsie** (the compass button) flags outstanding setup for this workspace and offers short tours (overview, making content, publishing, measuring, running the install); dismissing is "not now", turning her back on replays.

---

## 4. Setting keys (for reading a workspace's state)

`autonomy:full` · `autonomy:restore` (snapshot) · `autopilot:weekly_articles` · `autopilot:publish_day` · `blog:auto_seo` · `social:require_approval` · `social:autoqueue` · `social:evergreen_fill` · `social:auto_image` · `social:autogen` · `social:autogen_weekly` · `social:autogen_campaign` · `social:timezone` · `social:utm_enabled|source|medium|campaign` · `studio:enabled` · `digest:enabled` · `digest:hour` · `production:autotasks` · `branded_short:mode` · `image:provider` · `image:quality` · `video:provider` · `tts:provider` · `api_key:<provider>` (anthropic, google, openai, deepseek, xai, moonshot, minimax, tavily, serper, elevenlabs, heygen, youtube — youtube is platform-managed) · `zernio:api_key`, `zernio:webhook_secret` · `unipile:api_key`, `unipile:dsn` · `gsc:site_url` · `ganalytics_oauth:*` · `youtube_oauth:*` (per channel) · `storage:backend` (platform). Resolution: workspace setting → platform setting → environment variable, 30-second cache. Default-on dials store the explicit string `"false"` to turn off.

---

## 5. Routines and repeatable processes

### 5.1 Daily — about five minutes (admin or editor)

1. **Read the digest if one arrived.** No digest = nothing urgent.
2. **Open the Inbox** and work it top to bottom: approve or request changes on posts; answer questions in your own words (only what you'd stand behind if quoted); verify a claim with a real URL or drop it; approve or replace a held image; open a held article whose card names a check nobody else can fix. The count in the header sentence should reach zero.
3. **Engage** (Distribute → Engage): answer comments and DMs the day they arrive; the 24-hour window is the one hard deadline.
4. **Glance at the strip badges** as you pass through stages — a red badge is a person's job.
5. When unsure, open the Ask dock and say **"what should I do next?"** — it ranks the moves from the same data and does them with you (draft, fill SEO, queue, publish — proposing anything outward-facing first).

### 5.2 Weekly — about thirty minutes (best on the day before the publish day)

1. **Ideas**: triage Discovered — approve what is worth writing, reject the rest. An empty Approved pool means no new articles, whatever the dial says. Keep three to five approved.
2. **Drafts → Articles**: read what arrived — words, images and SEO together — and fix by hand only what auto-review could not. Check the Optimize tab's "Address these": answer knowledge cards (banked to the expert profile), decide strategic ones, let mechanical ones apply.
3. **Publish → Approvals** then **Distribute → Calendar**: approve the social week and make sure approved drafts are queued (an approved draft that was never queued never sends; queue on approval collapses the two).
4. **Publish**: confirm the article due on the publish day is at final approval; if there is no WordPress, download the HTML, add it to the site, Mark as published with the live URL.
5. **Measure → Social performance** and the best-time-to-post section under Settings → Schedule once the sample is big enough.
6. **Research**: skim the strong outliers; turn one into an idea if it fits a Topic.

### 5.3 Monthly — about an hour (admin)

1. **Insights and Reports**: what ranked, what got clicked, which networks earned their place; decide what to do more of.
2. **Brand → Tone & motifs**: adjust Motif weights, retire topics that ran dry, add what the numbers say is working; refresh the AI brand context (differentiators, products, documents).
3. **Settings → Automation**: raise the weekly targets if review has been easy, lower anything producing more than can be honestly reviewed; consider evergreen recycling once there is a body of posts worth resurfacing.
4. **Settings → Connections**: everything the loop needs still connected; provider billing surprises; analytics still pointing at the right properties.
5. **Settings → People**: joiners and leavers; pending invitations.
6. **Blog → Audit**: run a content audit; act on refresh/merge/retire recommendations.

### 5.4 Repeatable processes (recipes)

**Onboard a new workspace from zero.** Settings → Keys (paste an AI key, set the default model to match) → Settings → Connections (social accounts via this app's Connect buttons, a mailbox) → Publish → Website (WordPress) → Brand → Tone & motifs and Organization (voice, topics, guardrails, brand kit, AI brand context) → Settings → Schedule (timezone, slots) → Settings → People (invite; require approval if there is a team) → Settings → Automation (start with modes on assisted and low targets; raise later) → Settings → Analytics (Search Console + GA4). Then run Elsie's short tour.

**Publish an article end to end.** Ideas (approve) → the sweep drafts it, or "Send to draft" → auto-review fills SEO, renders images, sources claims → Inbox shows anything it could not fix → fix or answer → auto-advance to final approval → publish day (or Publish now) → Publish → recently published shows the live link → social variants follow under the social mode.

**Override a held article (admin).** Inbox → the held-article card → optional reason → **Advance anyway**. Records who, when and why on the article and in the audit log, moves it to final approval now, and carries through the sweep and publishing. Every clearing act (answer or dismiss a question, verify or drop a claim, approve an image) also advances the article at once when it was the last blocker — nothing waits for the next sweep.

**Handle a held image.** Inbox → "Images that need your eye" → Approve, or "Pick or upload instead" in the article's editor. The brake means auto-review already spent up to three renders.

**Handle an unsourced claim.** Inbox → "Claims with no source" → Verify with a URL that actually supports the sentence, or Drop the claim (removes the marker and the record; edit the sentence in the editor if it should go). The next sweep advances the article.

**Answer a knowledge question.** Inbox or the article's Optimize tab → answer in your own words → it is woven into the article and banked in the Experts profile so it is asked once.

**Publish without WordPress.** Publish → Download HTML (self-contained: meta, Open Graph, images embedded) → add to the site → Mark as published with the live URL. For social previews, upload the Open Graph image to the site and point `og:image` at its public URL (crawlers ignore embedded images). `?fragment=1` gives just the article body for a CMS block.

**Add a competitor and mine it.** Research → Intel → add by @handle or keyword → outliers appear as videos index → Bookmarks for the ones to keep → "Make it an idea" or open the video and chat with it.

**Change cadence.** Settings → Automation: weekly article target and publish day; social n/week; Settings → Schedule: slots. Under full autonomy nothing else is needed.

**Turn the video studio on or off.** Settings → the Video studio card (needs a YouTube channel).

**Run the loop by hand for a day.** Settings → Automation → Run cycle now; then watch Drafts and the Inbox.

**Move a script through the studio.** Ideas (video) → Write → script canvas or builder → Thumbnails (Clone looks at the reference) → Production board (Writer's Room → Film Queue → Edit Bay → Calendar) → Videos (Veo render from a storyboard).

---

## 6. Troubleshooting (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| Output reads generic, mentions "mock", or `[mock N: no API key]` | No working AI key resolved for this workspace; the app fell back to placeholders | Settings → Keys: paste a key for *this* workspace, set the model to match. Keys are per workspace. |
| The Assistant refuses every turn ("no working AI key") | Same as above (it refuses rather than guesses) | Same fix. |
| Nothing is being drafted | Approved pool is empty, the weekly target is reached, the daily budget is spent, drafting mode is manual, or global pause is on | Approve ideas; check Settings → Automation. |
| Article held at review, card names "No unresolved [NEEDS SOURCE] markers" and there is no claim card | A marker with no citation row (now auto-reconciled each sweep) or no live-search key | Wait one sweep; check Settings → Connections for a search key; otherwise open the article, verify or remove the marker's sentence. |
| Article at final approval, nothing publishes | Not the publish day yet; or no WordPress connection; or publishing mode not auto | Publish stage sentence says which; Download HTML + Mark as published if no site. |
| Social posts never send | No slots or timezone; post awaiting approval; approved but never queued; account broken | Settings → Schedule; Publish → Approvals; Distribute → Calendar; Distribute accounts chips. |
| "Token expiry" note on an account while the provider says connected | Zernio refreshes short-lived tokens; the note is informational | Only act if the account chip is red (Zernio's own verdict). |
| Measure shows dashes | Analytics not connected, or Search Console permission missing for the property | Settings → Analytics runs a live probe; add the service account to the Search Console property; a disabled API and a missing grant both return 403. |
| A button does nothing or errors after an update | A tab held open across a deployment | Reload the page. |
| Elsie's welcome tour covers the page for a new user | First visit, by design | Close it ("not now") or take the short tour. |
| The autopilot looks dead (no cycle for hours) | Idle sweeps write nothing | Look for other system rows (analytics, performance syncs) or run a cycle now; a real failure logs "cycle failed". |
| Images keep getting rejected | The vision reviewer found a defect (cut-off text, wrong brand name, glitches); after two strikes it stops spending | Approve the render or upload one; check the brand kit's image specs and brand name. |

---

## 7. For Claude working on the codebase

**Repo**: `C:\Users\Admin\meyousocial` (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Prisma 6 + Postgres, Auth.js v5). Read `CLAUDE.md` and `AGENTS.md` first. The git-ignored `MEYOUSOCIAL-NEXT-SESSION.local.md` is the session handoff (§3 = what is next; §5 = session log) and holds production credentials — **never commit it, never paste its secrets anywhere public** (both remotes are public).

**House rules**: `tsc --noEmit` then `npm run build` before every commit; commit with `git commit -F <file>` (quotes break PowerShell); push to BOTH remotes — `git push origin main; git push deploy main:main` (Railway builds from `deploy`); throwaway probes in `scripts/_tmp-*.mts` run with `npx tsx` and deleted after (they break the next build if left — and a background probe deleting itself mid-build fails that build); never write migration SQL via PowerShell (BOM); never `git add -A`; multi-line perl edits can miss silently — grep the symbol afterwards or use the Edit tool; `${var}` inside a perl replacement is swallowed.

**Where things live**: stages and strip — `src/lib/stages.ts`, `src/components/StageStrip.tsx`, `src/lib/stage-counts.ts`; rail — `src/app/(app)/layout.tsx` (NAV), `src/components/LeftRailNav.tsx`, `MobileNav.tsx`; stage pages — `src/app/(app)/<stage>/page.tsx` on `src/components/StageShell.tsx`; Inbox — `src/lib/inbox.ts`, `src/components/NeedsYou.tsx`; Ideas board — `src/lib/ideas-board.ts`; Settings — `src/app/(app)/setup/*`, `src/lib/setup-status.ts`, `src/lib/studio.ts`; autopilot — `src/lib/blog-autopilot.ts`; auto-review — `src/lib/blog-autoreview.ts`; gates — `src/lib/blog-checks.ts`; findings — `src/lib/blog-findings.ts`; citations extraction — `src/lib/citations-extract.ts`; governance/modes — `src/lib/governance.ts`, `src/lib/autonomy.ts`; social — `src/lib/social/*`, `src/lib/zernio/*`; assistant — `src/lib/assistant/{run,tools,knowledge,session}.ts` (tools = the registry: `readOnly` / `confirm` / `minRole`; run = the loop with ask/confirm/links protocol + pending proposal; session = `runTurn`), `app/api/assistant/route.ts` (dock JSON), `components/AssistantDock.tsx` (mounted in the app layout); help — `src/lib/help.ts`, `src/app/(app)/help/*`; tooltips — `src/lib/help-tips.ts`; guide tours — `src/lib/guide/steps.ts`; settings resolution — `src/lib/settings.ts`; LLM router — `src/lib/llm/*` (transparent mock fallback; `provider` is stamped by the router; unattended paths refuse `provider === "mock"`).

**Deploy and verify**: after pushing, poll `railway deployment list --service "@spark/web" --json` until index 0 is SUCCESS for the commit. Verify on production with a throwaway fixture user on the Demo workspace (`demo-workspace`, channel `demo-channel`): create by script (bcrypt hash, ADMIN membership), sign in either in the browser pane or via curl (`GET /api/auth/csrf` → `POST /api/auth/callback/credentials` into a private cookie jar), exercise the feature, clean up through the app's own delete buttons where they exist and by script otherwise (declared), and confirm zero leftovers. Never use or sign out the owner's real session in the pane; if the owner signs the pane in, treat it as read-only. A server action can be posted without JavaScript as **multipart** form data carrying the hidden `$ACTION_ID_…` field from the page's HTML (urlencoded silently does nothing). Hydrated forms in the pane need `form.requestSubmit()`, not `submit()`.

**Reading production state** (read-only probes): Prisma via `scripts/_tmp-*.mts` with `DATABASE_URL` from the local handoff doc; the app's own gate logic can be imported (`runBlogChecks` from `@/lib/blog-checks`, `loadAssetGate` from `@/lib/blog-images`, `loadEditorialContext` from `@/lib/blog-slop`; set `TOKEN_ENCRYPTION_KEY`). Useful audit actions: `autopilot.cycle` (only when active), `blog.draft_generated`, `blog.auto_advanced`, `blog.image_generated|approved|auto_rejected`, `blog.citation_autoverified|unsourceable|dropped`, `blog.findings_generated|finding_applied|finding_answered`, `blog.published_manually`, `social.approved`, `social.settings_saved`, `settings.saved`, `membership.role_changed`, `analytics.synced`, `social.performance_synced`, `notify.digest_sent`.

**Known traps**: `models.list()` lies on the Google key (probe a model before shipping it); an idle autopilot is silent; `LLMResponse.provider` is the router's stamp; `social:require_approval` is written only by its own action now; two idea tables beneath one board; the Blog and Social sub-nav bars are gone (the strip replaced them); Railway blocks SMTP (mail goes through Unipile); the `deploy` remote is the one Railway builds.
