# CreateUp — Build Plan & Requirement Checklist

Generated from CreateUp_Requirements.docx. **172 functional requirements** — 75 Must, 78 Should, 19 Could.

**How to use:** Build in phase order. Within each module, do all **[Must]** items first (that is the MVP), then [Should], then _[Could]_. Check the box and reference the FR-ID in your commit message. Each item maps to behavior in the requirements doc; the matching screen is in CreateUp_Mockups.html (see the doc's screen-inventory appendix).

> No billing / credits / payments anywhere. Access = individual logins + Admin/Editor/Viewer roles + optional non-paid soft limits.

---

## Phase 0 — Foundation & Platform

_Stand these up first; everything depends on them._

### Accounts, Auth & Workspaces  `AUTH`  (8 Must / 9 total)

- [x] **[Must]** `FR-AUTH-01` — Each user has an individual login: register and authenticate via email/password and at least one OAuth/SSO provider (e.g. Google). Accounts are never shared.
- [x] **[Must]** `FR-AUTH-02` — Every user belongs to at least one Workspace (a personal workspace is created on signup); a user may belong to several.
- [x] **[Must]** `FR-AUTH-03` — Roles are Admin (all features, user & workspace management), Editor (create/edit scripts, research, creative features), and Viewer (read-only).
- [x] **[Must]** `FR-AUTH-04` — Admins can invite members by email and assign a role; invitees receive an email invitation and join, with their own login, on acceptance.
- [x] **[Must]** `FR-AUTH-05` — Channels, scripts, research and bookmarks are shared and accessible to all members of the owning workspace, subject to role.
- [x] **[Must]** `FR-AUTH-06` — There is no billing or credit system. The platform is free to all invited users; AI usage is unmetered except for optional admin-set soft limits (FR-ADMIN-03).
- [x] **[Must]** `FR-AUTH-08` — Admins can change roles and revoke members; revoked members immediately lose access.
- [ ] **[Must]** `FR-AUTH-09` — Support password reset, email verification, secure session management, and per-user activity attribution. _(session mgmt + activity tracking done; password reset + email verification pending)_
- [ ] [Should] `FR-AUTH-07` — Chat threads are per-user but referenceable by teammates.

### Workspace Administration  `ADMIN`  (2 Must / 6 total)

- [x] **[Must]** `FR-ADMIN-01` — Admin Users page: list members with role, status and last activity; add (invite), edit role, deactivate and remove users.
- [x] **[Must]** `FR-ADMIN-06` — All AI features (chat, ideas, research, scripts, thumbnails, agent mode) are available to every member at no cost, subject only to role and optional soft limits.
- [ ] [Should] `FR-ADMIN-02` — Workspace settings: name, default channel, default AI model/language, and theme defaults.
- [ ] [Should] `FR-ADMIN-03` — Optional soft usage limits set by an admin (e.g. monthly script generations and thumbnail generations per user or per workspace) to manage shared infrastructure cost — disabled by default, never tied to payment.
- [ ] [Should] `FR-ADMIN-04` — Usage dashboard: generations, active users, scripts created, and (if enabled) progress against soft limits.
- [ ] [Should] `FR-ADMIN-05` — Channels, scripts, research and bookmarks are visible to all members per role; admins can reassign channel ownership.

### AI Models & Provider Routing  `MODEL`  (4 Must / 6 total)

- [x] **[Must]** `FR-MODEL-01` — Support multiple selectable text models from several providers (e.g. Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, xAI Grok, Moonshot Kimi, MiniMax). Names track current stable versions. _(registry done; real adapters wired as keys are added)_
- [x] **[Must]** `FR-MODEL-02` — Models are interchangeable for outline, full script and edits; users may mix models within one script.
- [x] **[Must]** `FR-MODEL-03` — All AI usage is free to members; model choice never incurs any charge. (Operational provider cost is borne by the operator, not passed to users.)
- [x] **[Must]** `FR-MODEL-04` — Provide a model-routing/abstraction layer so providers/versions can be added or swapped without UI/contract changes.
- [ ] [Should] `FR-MODEL-05` — Surface model characteristics guidance (speed, length adherence, style) to help selection.
- [ ] [Should] `FR-MODEL-06` — Use image-generation model(s) for thumbnails and audience photos; voice/avatar models for the production pipeline.

### Settings & Preferences  `SET`  (0 Must / 4 total)

- [ ] [Should] `FR-SET-01` — Light/Dark/Auto theme.
- [ ] [Should] `FR-SET-03` — User Guide / Help center and contextual help (‘?’) accessible in-app.
- [ ] _[Could]_ `FR-SET-02` — Keyboard shortcuts for common actions (e.g. open Prompt Library, navigate canvas).
- [ ] _[Could]_ `FR-SET-04` — A Production Board (kanban) to track videos through stages (idea → scripting → packaging → ready), surfacing scripts, ideas and thumbnails.

### Platform / API  `PLAT`  (0 Must / 1 total)

- [ ] _[Could]_ `FR-PLAT-01` — Provide API access and an MCP server so external AI clients/tools can drive CreateUp (available to all members; admin-toggleable).

### Language Support  `I18N`  (0 Must / 1 total)

- [ ] [Should] `FR-I18N-01` — Generate scripts in 25+ languages (incl. Arabic, Bengali, Chinese (Simplified), Czech, Danish, Dutch, English, Finnish, French, German, Greek, Hindi, Indonesian, Italian, Japanese, Korean, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Spanish, Swedish, Thai, Turkish, Ukrainian, Vietnamese); UI is English in v1.

---

## Phase 1 — Channels & Channel Modeling

_A configured channel with trained voice and audience._

### Onboarding Wizard  `ONB`  (10 Must / 10 total)

- [x] **[Must]** `FR-ONB-01` — Step 1 — capture a free-text description of the creator’s content/niche.
- [x] **[Must]** `FR-ONB-02` — Step 2 — choose presentation style: Personality (on-camera) or Faceless (topic/visual/voiceover).
- [x] **[Must]** `FR-ONB-03` — Step 3 — choose path: link an existing YouTube channel, or start a new (custom) channel.
- [x] **[Must]** `FR-ONB-04` — Step 4 (YouTube path) — find a channel by URL/@handle with no YouTube login; show subscriber count and video library for confirmation. If <3 videos, prompt for a channel description.
- [x] **[Must]** `FR-ONB-05` — Step 4 (Custom path) — capture channel name and a detailed niche/audience description.
- [x] **[Must]** `FR-ONB-06` — Step 5 — select competitors: AI-suggests channels by niche; user can add suggested, search by URL/@handle, or remove. Step is optional (skippable).
- [x] **[Must]** `FR-ONB-07` — Step 6 — capture differentiation statement (min 20 chars).
- [x] **[Must]** `FR-ONB-08` — Step 7 — show generated Audience Avatar preview and a stream of up to 10 starter Ideas; allow Write (open canvas) or Skip for Now.
- [x] **[Must]** `FR-ONB-09` — Background jobs generate Voice (from top videos ≥3 min), Audience Avatar, and Ideas; the wizard shows progress/checkmarks and continues even after the user leaves.
- [x] **[Must]** `FR-ONB-10` — Users can start scripting immediately while generation completes asynchronously (target minutes; up to ~1 hour under load).

### Channels & Settings  `CHAN`  (5 Must / 8 total)

- [x] **[Must]** `FR-CHAN-01` — Users can create multiple channels (subject to any optional admin limit) and switch the active channel via a selector visible across the app.
- [x] **[Must]** `FR-CHAN-02` — Each channel stores its own voice profile(s), audience avatar, competitors, scripts, ideas, research, templates and settings.
- [x] **[Must]** `FR-CHAN-03` — Channel navigation exposes: Ideas, Scripts, Audience, Competitors, plus a Settings menu (Channel Settings, Voice, Templates, Research).
- [x] **[Must]** `FR-CHAN-04` — Channel Settings include details, linked YouTube channel, and Script Defaults (default template, default Draft Writing Model, default language).
- [x] **[Must]** `FR-CHAN-07` — Competitors: add/search/remove tracked competitor channels post-setup; competitors feed idea generation and research.
- [ ] [Should] `FR-CHAN-05` — Users can relink/change the linked YouTube channel, which re-analyzes content and updates voice & audience.
- [ ] [Should] `FR-CHAN-06` — Channel Memory: users store durable facts/preferences that the AI automatically applies across scripts in that channel; memory is viewable/editable.
- [ ] _[Could]_ `FR-CHAN-08` — Business/brand channels are supported (channels representing a company/product rather than a person).

### Voice Profiles  `VOICE`  (5 Must / 8 total)

- [x] **[Must]** `FR-VOICE-01` — Auto-train a voice profile during onboarding from the channel’s top 10 videos (5 most-viewed + 5 most-recent), using only videos ≥3 minutes with sufficient transcript.
- [x] **[Must]** `FR-VOICE-02` — When insufficient long videos exist, generate a baseline voice from available content/description and improve automatically as more videos publish.
- [x] **[Must]** `FR-VOICE-03` — Simple mode: refine the voice with natural-language instructions (e.g. ‘more casual’, ‘shorter sentences’); generate a preview and iterate on feedback.
- [x] **[Must]** `FR-VOICE-04` — Advanced mode: expose and edit all parameters across Speaker Archetype (age vibe, profession archetype, temperament, authority posture), Delivery Recipe (cadence, energy, pacing/emphasis), Rhetorical Toolkit (hooks, transitions, CTAs, analogy/evidence, humor/empathy), Diction & Syntax (vocabulary level, sentence shape, preferred constructions, words to avoid), and Additional Settings (phrase kit, jargon policy, formatting directives, do/don’t rules).
- [x] **[Must]** `FR-VOICE-08` — Generate Preview produces a short voice sample instantly and for free.
- [ ] [Should] `FR-VOICE-05` — Add writing samples (up to 50,000 characters each: transcripts, blogs, threads, scripts) to enhance training.
- [ ] [Should] `FR-VOICE-06` — Borrow a voice: train a profile from another public YouTube channel’s transcripts and apply it to the user’s topics.
- [ ] [Should] `FR-VOICE-07` — Support multiple voice profiles per channel; set a channel default and override per script.

### Audience Avatar  `AUD`  (4 Must / 5 total)

- [x] **[Must]** `FR-AUD-01` — Auto-generate an avatar during onboarding from the top 5 videos by views (linked) or the user’s description (custom).
- [x] **[Must]** `FR-AUD-02` — Avatar contains Demographics, Psychographics, Online Behavior, Offline Behavior and Key Questions.
- [x] **[Must]** `FR-AUD-04` — Edit any section manually, or fully refresh the avatar from latest YouTube data (overwriting customizations, with confirmation).
- [x] **[Must]** `FR-AUD-05` — Audience context is injected into idea generation, chat and script writing.
- [ ] [Should] `FR-AUD-03` — Generate a representative AI audience photo with a refresh control for an alternate image.

---

## Phase 2 — Research & Ideation

_Find what works and turn it into validated ideas._

### Intel (Research Database)  `INTEL`  (8 Must / 13 total)

- [x] **[Must]** `FR-INTEL-01` — Search channels and videos via natural language; keywords like ‘channel’/‘niche’ bias toward channel results, otherwise video results.
- [ ] **[Must]** `FR-INTEL-02` — Support advanced query syntax for subscriber ranges, velocity (e.g. ‘velocity > 2’), engagement (views/sub), creation date, video count, performance (views, outlier score), timeframe and format (shorts/longs), in combination. _(explicit filters work; free-form query syntax not yet parsed)_
- [x] **[Must]** `FR-INTEL-03` — Provide explicit filters: subscriber min/max, velocity score, language, content type (long/shorts/both).
- [x] **[Must]** `FR-INTEL-04` — Compute and display Velocity Score (momentum) and tag fast-growing channels.
- [x] **[Must]** `FR-INTEL-05` — Compute Outlier Score = video views ÷ average views of up to 10 surrounding videos on the same channel; display with severity bands (≥5x exceptional, 2–5x strong, 1–2x average, <1x under).
- [x] **[Must]** `FR-INTEL-07` — Channel detail view: subscriber/growth trends, total & average views, upload frequency/consistency, top videos (sortable by views/outlier), and outlier videos.
- [x] **[Must]** `FR-INTEL-08` — Video detail view: views/engagement, outlier score, views/sub, title and thumbnail.
- [x] **[Must]** `FR-INTEL-11` — Bookmark channels/videos with tags and notes; bookmarks are team-shared and have a dedicated page.
- [ ] [Should] `FR-INTEL-06` — Compute and display Views/Sub ratio with a High indicator for strong beyond-subscriber reach.
- [ ] [Should] `FR-INTEL-09` — Find Similar Channels for any channel.
- [ ] [Should] `FR-INTEL-10` — Chat with Channel / Chat with Video: open an AI conversation scoped to that entity.
- [ ] [Should] `FR-INTEL-12` — Searching an unindexed channel by @handle auto-queues it for indexing and adds it for all users.
- [ ] [Should] `FR-INTEL-13` — Intel dashboard surfaces curated modules: Trending niches, Outlier videos this week, Hot new channels (with Velocity Score), and Growth insights.

### Ideas (Outlier Generation)  `IDEA`  (5 Must / 9 total)

- [x] **[Must]** `FR-IDEA-01` — Generate sets of (default 10) ideas by identifying outlier videos across the channel’s niche AND deliberately selected adjacent niches (based on category/keywords/competitors).
- [x] **[Must]** `FR-IDEA-02` — Each idea includes: Title (hook-bearing working title), Topic, Strategy (the psychological hook / why it works), Source video (with views & outlier score), and Suggested length.
- [x] **[Must]** `FR-IDEA-03` — Maintain an Ideas Library with sort (newest, highest outlier score) and filters (status, source).
- [x] **[Must]** `FR-IDEA-07` — Write action opens the Canvas with the idea’s context (title, topic, strategy, source) pre-loaded.
- [x] **[Must]** `FR-IDEA-09` — On-demand regeneration to refresh the pipeline against the latest outlier data.
- [ ] [Should] `FR-IDEA-04` — Change Topic: preserve an idea’s proven hook structure while redirecting it to a new subject.
- [ ] [Should] `FR-IDEA-05` — Generate Titles: produce title variations/angles for an idea.
- [ ] [Should] `FR-IDEA-06` — Generate thumbnail concepts for an idea (links to Thumbnails module).
- [ ] [Should] `FR-IDEA-08` — Idea status workflow (e.g. new / in-progress / scripted / archived) for pipeline management.

### Ideation Chat  `CHAT`  (6 Must / 12 total)

- [x] **[Must]** `FR-CHAT-01` — Chat is channel-scoped: the selected channel’s voice and audience condition all responses; require a channel selection before chatting.
- [x] **[Must]** `FR-CHAT-02` — Accept plain-language questions, pasted YouTube video/channel URLs, and document uploads as context.
- [x] **[Must]** `FR-CHAT-03` — Analyze pasted YouTube videos (fetch metadata, transcript, structure) and channels (content strategy, top videos, outliers, posting patterns); support remixing into new angles.
- [ ] **[Must]** `FR-CHAT-07` — Upload files as context — PDF, Word (.doc/.docx), text (.txt/.md/.json/.csv) and images (.jpg/.png/.gif/.webp), up to 10MB each. _(URL + pasted-text context done; file upload pending in Phase 3 alongside Canvas FR-CANV-08)_
- [x] **[Must]** `FR-CHAT-10` — Intent like ‘turn this into a script’ creates a script project and opens the Canvas with context carried over.
- [x] **[Must]** `FR-CHAT-11` — Maintain full-conversation context awareness; chat is rate-limited (not credit-metered) with clear back-off messaging.
- [ ] [Should] `FR-CHAT-04` — Answer in-chat outlier requests with filters (e.g. ‘long-form outliers only’, ‘last 6 months’, ‘top 10 about <topic>’).
- [ ] [Should] `FR-CHAT-05` — Perform quick web search for current information within the conversation.
- [ ] [Should] `FR-CHAT-06` — AI Research: a deep, multi-source research tool (separate from quick search) that synthesizes findings into a saved, referenceable report in the research library.
- [ ] [Should] `FR-CHAT-08` — Prompt Library: categorized, ready-made prompts insertable into chat and editing; openable via keyboard shortcut.
- [ ] [Should] `FR-CHAT-09` — Research sidebar auto-collects AI-generated research; items can be starred (persist across all scripts) or deleted.
- [ ] [Should] `FR-CHAT-12` — Maintain chat history grouped by recency (This Week / Last Week / older), searchable, scoped to channel.

### Research & Sources  `RES`  (2 Must / 5 total)

- [ ] **[Must]** `FR-RES-01` — Add research from YouTube URLs (transcripts), web articles, uploaded PDFs/Word/text/image files (≤10MB each), and pasted text.
- [ ] **[Must]** `FR-RES-05` — Research is referenceable by the AI during planning, writing and fact-checking.
- [ ] [Should] `FR-RES-02` — Provide a deep AI Research tool that explores multiple sources, synthesizes a detailed report, and saves it to the research library for reuse.
- [ ] [Should] `FR-RES-03` — Apply a configurable research-depth word budget (e.g. Basic/Intermediate/Comprehensive/Exhaustive); all research is free (no credits/metering beyond optional admin limits).
- [ ] [Should] `FR-RES-04` — Starred research persists and is available across all scripts in the channel, not just the current thread; irrelevant items can be deleted.

---

## Phase 3 — Scripting

_The core writing experience._

### Script Canvas  `CANV`  (14 Must / 15 total)

- [ ] **[Must]** `FR-CANV-01` — Enforce a one-chat-one-script model: each thread develops a single video; provide Start Over (same topic) and direct users to a new thread for different topics.
- [ ] **[Must]** `FR-CANV-02` — Split-panel UI: left chat, right editor; panels resizable via divider and individually collapsible.
- [ ] **[Must]** `FR-CANV-03` — Plan mode: present optional planning questions (main takeaway, audience concerns, points to cover, desired viewer action) then generate an editable outline (hook/intro, sections with key points, transitions, conclusion + CTA).
- [ ] **[Must]** `FR-CANV-04` — Script mode: expand the approved outline into full prose applying voice profile, audience and template; stream output section by section.
- [ ] **[Must]** `FR-CANV-05` — Plan/Script tab toggle; users can return to Plan, restructure, and regenerate sections.
- [ ] **[Must]** `FR-CANV-06` — Model selector per script with the ability to switch mid-script (e.g. one model for outline, a faster one for edits); honor channel default.
- [ ] **[Must]** `FR-CANV-07` — Template selector with the ability to switch templates at any time during creation.
- [ ] **[Must]** `FR-CANV-08` — Add Context: attach YouTube URLs (transcripts), web articles, uploaded PDFs/docs, and pasted custom text, within plan-based research word limits.
- [ ] **[Must]** `FR-CANV-09` — Direct rich-text editing with autosave.
- [ ] **[Must]** `FR-CANV-10` — Highlight-and-Improve: select text to reveal a toolbar of improvement options plus a custom-instruction field; the AI rewrites only the selection.
- [ ] **[Must]** `FR-CANV-11` — Humanize: one-click rewrite that strips AI patterns, merges choppy sentences, upgrades to vivid/specific language, targets ~6th–7th-grade spoken readability, optimizes for AI voiceover, and preserves the voice profile; streams section by section.
- [ ] **[Must]** `FR-CANV-12` — Provide unlimited free regenerations (Start Over and Humanize), since there is no credit system; warn before destructive Start Over.
- [ ] **[Must]** `FR-CANV-13` — Live word count and estimated spoken duration; support scripts up to 30,000 words / ~3 hours.
- [ ] **[Must]** `FR-CANV-15` — Scripts list per channel with metadata (title, length, status, updated).
- [ ] [Should] `FR-CANV-14` — Version history: snapshot generations/major edits; allow review and restore.

### Script Builder (Classic)  `SB`  (0 Must / 12 total)

- [ ] [Should] `FR-SB-01` — Provide a 10-step builder with a left step sidebar: (1) Research, (2) Frame, (3) Title, (4) Thumbnail, (5) Hook, (6) Payoffs, (7) Draft, (8) Edit, (9) Export, (10) Publish, plus a Summary overview.
- [ ] [Should] `FR-SB-02` — Research step: add documents (PDF/Word/text/images ≤10MB), links (URL extraction), YouTube videos (transcripts), and items from starred research; show research-depth Level with word budget — Basic 5,000 / Intermediate 15,000 / Comprehensive 45,000 / Exhaustive 90,000.
- [ ] [Should] `FR-SB-03` — Frame step: choose a narrative framework (templates), define the specific angle, and set learning/emotional goals for viewers.
- [ ] [Should] `FR-SB-04` — Title step: review AI title suggestions (from research + frame) or write a custom title.
- [ ] [Should] `FR-SB-05` — Thumbnail step: review suggested thumbnail concepts that complement the title (links to Thumbnails module).
- [ ] [Should] `FR-SB-06` — Hook step: review/select/customize an opening hook that delivers on the title’s promise.
- [ ] [Should] `FR-SB-07` — Payoffs step: select and prioritize the key information payoffs the video will deliver, aligned to title and hook.
- [ ] [Should] `FR-SB-08` — Draft step: generate the full script section-by-section using the voice profile; show each section’s plan and content; regenerate any individual section without affecting the others.
- [ ] [Should] `FR-SB-09` — Edit step: AI-suggested edits for flow/engagement plus manual editing (shares the writing/Humanize tools).
- [ ] [Should] `FR-SB-10` — Export step: copy to clipboard, download as a document, and optionally export research notes separately.
- [ ] [Should] `FR-SB-11` — Publish step: generate YouTube tags, description and finalized metadata.
- [ ] [Should] `FR-SB-12` — Navigation: Continue advances steps; clicking a completed step in the sidebar returns to it (later steps may flag for regeneration). Progress autosaves; multiple builder scripts can run simultaneously and appear in the channel scripts list.

### Templates  `TMPL`  (1 Must / 5 total)

- [ ] **[Must]** `FR-TMPL-01` — Ship built-in long-form templates: Flexible, Educational (WHY-WHAT-HOW), Documentary (3-act), Explainer, Commentary (Observation-Insight-Evidence), Review (Context-Finding-Verdict), Compilation, Fictional Story (3-act), VSL (Problem-Agitation-Solution), Listicle, Essay (thesis-driven), News (inverted pyramid), Experiment, Challenge.
- [ ] [Should] `FR-TMPL-02` — Ship shorts templates: Shorts Educational, Shorts Review, Shorts Story, Shorts Viral, Shorts Ad.
- [ ] [Should] `FR-TMPL-03` — Custom template by cloning a single video — capture section breakdown, pacing/timing, structural flow and transition patterns.
- [ ] [Should] `FR-TMPL-05` — Provide guidance mapping content type → recommended template; templates are switchable mid-script.
- [ ] _[Could]_ `FR-TMPL-04` — Combine 2–3 videos into one synthesized custom template; allow fine-tuning.

### Agent Mode & Pipeline  `AGENT`  (0 Must / 6 total)

- [ ] [Should] `FR-AGENT-01` — Launch from Canvas; run an automated pipeline: Research → Outline → Script → Quality checks (retention optimization, humanization, repetition cleanup) → Voiceover preparation.
- [ ] [Should] `FR-AGENT-02` — Run in the background (5–15 min typical) with a live progress panel; user may close the tab and is emailed on completion.
- [ ] [Should] `FR-AGENT-03` — Use the channel’s voice/audience and any attached research context; output appears in the Script tab with an outline in the Plan tab.
- [ ] [Should] `FR-AGENT-04` — Retries on the same script are free and automatic on failure; cancellation is immediate. (No credits are involved.)
- [ ] [Should] `FR-AGENT-06` — Output integrates with all standard editing tools (highlight-and-improve, Humanize, chat) for post-run refinement.
- [ ] _[Could]_ `FR-AGENT-05` — Optional, channel-enabled video production: AI voiceover from the script, presenter avatar video, shot-list planning and rendering, tracked in the same progress panel.

---

## Phase 4 — Packaging & Export

_Titles, thumbnails, export, promo._

### Thumbnail Studio  `THUMB`  (0 Must / 7 total)

- [ ] [Should] `FR-THUMB-01` — Brainstorm mode: from a video title (+ optional topic), generate 4 concept sketches across proven formats (~60–90s); selecting one opens a detail panel.
- [ ] [Should] `FR-THUMB-02` — Render a full-resolution, publish-ready thumbnail from a selected concept.
- [ ] [Should] `FR-THUMB-03` — Clone/Remix mode: accept a reference via YouTube URL or image upload, analyze its style (colors, typography, composition, lighting), and render a new thumbnail in that style; goes directly to final render.
- [ ] [Should] `FR-THUMB-05` — Maintain thumbnail history; allow re-download of any prior thumbnail at high resolution.
- [ ] _[Could]_ `FR-THUMB-04` — Score each thumbnail against CTR principles (contrast, readability) and offer one-click fixes for weak spots.
- [ ] _[Could]_ `FR-THUMB-06` — Thumbnail Settings: default brand assets and style preferences per channel.
- [ ] _[Could]_ `FR-THUMB-07` — Thumbnail generation is free; an admin may optionally set a soft monthly generation limit per user/workspace (no paid packs).

### Publishing, Promotion & Export  `PUB`  (1 Must / 4 total)

- [ ] **[Must]** `FR-PUB-01` — Export a finished script via Copy to Clipboard, Word (.docx) and PDF.
- [ ] [Should] `FR-PUB-02` — Teleprompter view: full-screen, large-text reading mode launched from export.
- [ ] [Should] `FR-PUB-03` — Generate promo assets from a finished script via Prompt Library: SEO video description, social package (Twitter/LinkedIn/Instagram), newsletter content, blog-post adaptation, and shot list / B-roll guide.
- [ ] [Should] `FR-PUB-04` — Auto-generate optimized titles/hooks and description & tags.

---

## Phase 5 — Production & Operations

_The run-the-channel layer (post-scripting)._

### Production Pipeline  `PIPE`  (0 Must / 6 total)

- [ ] [Should] `FR-PIPE-01` — Promote any script/idea into a Content Project with a Status lifecycle: Idea → Research/Writing → Recording → Editing → Scheduled → Published.
- [ ] [Should] `FR-PIPE-02` — Writer’s Room view: filter to projects in Research/Writing, with due-soon indicators and per-assignee filtering.
- [ ] [Should] `FR-PIPE-03` — Film Queue view: filter to projects in Recording; group by shoot day; surface each project’s shot list.
- [ ] [Should] `FR-PIPE-04` — Edit Bay: a kanban board keyed on an Edit Status property — Assembly, Rough cut, VFX, Sound & music, Color grading — for post-production tracking.
- [ ] [Should] `FR-PIPE-05` — Assign one or more members to a project/role; provide a ‘my work’ filter across all pipeline views.
- [ ] [Should] `FR-PIPE-06` — A configurable board/Production Board view of all content by status, with drag-to-advance between stages.

### Tasks  `TASK`  (0 Must / 2 total)

- [ ] [Should] `FR-TASK-01` — Create tasks with assignee, due date, status and optional link to a Content Project; show a per-user task list.
- [ ] _[Could]_ `FR-TASK-02` — Group tasks under projects; show task progress on the related content project.

### Content Calendar  `CAL`  (0 Must / 2 total)

- [ ] [Should] `FR-CAL-01` — Content Calendar: month/week views of content by target publish date, color-coded by status/channel.
- [ ] [Should] `FR-CAL-02` — Set a publish date per project; surface upcoming and overdue content on the Dashboard.

### Assets (B-roll)  `ASSET`  (0 Must / 3 total)

- [ ] [Should] `FR-ASSET-01` — A single, centralized B-roll/shotlist library (not one per project); items can be linked to one or more Content Projects and scoped to a Channel.
- [ ] [Should] `FR-ASSET-03` — Favorite reusable B-roll items; store either uploaded assets or links to cloud storage; filter/search the library.
- [ ] _[Could]_ `FR-ASSET-02` — Import shot lists / markers from external tools (e.g. Premiere Pro markers, Frame.io comments via file/CSV) and attach to a project.

### Swipes (Inspiration)  `SWIPE`  (0 Must / 3 total)

- [ ] [Should] `FR-SWIPE-01` — A visual Swipe File library for inspiration (thumbnails, set/studio design, landing pages) with image previews, tags and source URL.
- [ ] _[Could]_ `FR-SWIPE-02` — Capture inspiration via web link (auto-extract image, title, source URL) or direct upload; one-click save from a browser clipper.
- [ ] _[Could]_ `FR-SWIPE-03` — Auto-capture YouTube thumbnails to Swipes with title and URL pre-filled; reference Swipes from the Thumbnail Studio.

### Knowledge Base & SOPs  `WIKI`  (0 Must / 3 total)

- [ ] [Should] `FR-WIKI-01` — A Wiki of process docs, SOPs and reference guides, browsable in one place.
- [ ] _[Could]_ `FR-WIKI-02` — Scope wiki pages to a Channel; show a channel’s related docs (e.g. its publishing checklist) on the channel page.
- [ ] _[Could]_ `FR-WIKI-03` — Reusable checklists (e.g. pre-publish QA) attachable to content projects.

---

## Phase 6 — Growth Loop

_Close the loop and refine._

### Performance / Stats Sync  `PERF`  (0 Must / 2 total)

- [ ] [Should] `FR-PERF-01` — Sync the workspace’s own published YouTube video stats (views, retention proxies, engagement) into each Content Project, with periodic refresh.
- [ ] _[Could]_ `FR-PERF-02` — Surface own-channel performance trends and feed them into idea generation and voice/audience refinement.

### Audience Submissions  `SUB`  (0 Must / 1 total)

- [ ] [Should] `FR-SUB-01` — Provide a public Audience Submission form to collect topic ideas from viewers; submissions flow into a reviewable queue and can be promoted to Ideas.

### Idea Merit Tags  `MERIT`  (0 Must / 1 total)

- [ ] [Should] `FR-MERIT-01` — Tag ideas/content with an Idea Merit (e.g. Content Pillar, Trending Topic, Experiment) for content-mix balancing and filtering.

### Keywords / SEO  `KW`  (0 Must / 1 total)

- [ ] _[Could]_ `FR-KW-01` — Track target keywords per Content Project (a keyword list with optional notes/volume) for SEO management.

### Chapter Markers  `CHAP`  (0 Must / 1 total)

- [ ] _[Could]_ `FR-CHAP-01` — Auto-generate YouTube chapter markers/timestamps from a finished script or outline.

### Repurposing  `REPURP`  (0 Must / 1 total)

- [ ] _[Could]_ `FR-REPURP-01` — Create linked derivative Content Projects (e.g. a Short from a long-form video) that reference the parent for repurposing.

---

## Cross-cutting (apply to every module)

- [ ] Match the corresponding mockup screen (layout, accent color, IBM Plex Mono/Sans, components).
- [ ] Enforce role-based access (Admin/Editor/Viewer) server-side on every endpoint.
- [ ] Scope all data to the owning Workspace; attribute records to the creating user.
- [ ] Stream long-running AI output; show progress for background jobs.
- [ ] Read all secrets from env (.env); never hardcode. Keep .env.example current.
- [ ] All AI providers behind one routing interface (FR-MODEL-04) so models are swappable.
- [ ] App must boot and be demoable with mock services and zero external keys.
