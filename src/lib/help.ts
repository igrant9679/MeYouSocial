// Searchable Help / FAQ content.
// Plain data so the UI is purely client-side searchable.

export type FaqEntry = {
  q: string;
  a: string;
  links?: Array<{ label: string; href: string }>;
  tags?: string[];
};

export type FaqCategory = {
  id: string;
  label: string;
  color: string;
  soft: string;
  entries: FaqEntry[];
};

export const HELP_CATEGORIES: FaqCategory[] = [
  {
    id: "getting-started",
    label: "Getting started",
    color: "#E5482F",
    soft: "#FDE7E1",
    entries: [
      {
        q: "I'm brand new — what do I do first?",
        a: "Click **+ Channel** in the topbar. The onboarding wizard captures your niche, presentation style, optional YouTube link, competitors, and differentiation. When it finishes, voice + audience + 10 starter ideas have all been generated in the background. From there, click any idea → **Write** → you're in the Canvas.",
        links: [{ label: "Create a channel →", href: "/onboarding/channel/new" }],
        tags: ["onboarding", "first time"],
      },
      {
        q: "How long does the full idea→draft flow take?",
        a: "Our spec target: under 12 minutes. Click an idea, hit **Run Agent** in the script toolbar, and the pipeline does research → outline → script → QA passes → voiceover prep on its own. You can close the tab; you get an email when it's done.",
        tags: ["agent", "speed", "draft"],
      },
      {
        q: "What are all the icons on the left bar?",
        a: "Top to bottom: **Home** (dashboard with KPIs, charts and the content pipeline), **Channels**, **Intel** (research outliers), **Ideas**, **Scripts**, **Blog** (the article workspace), **Videos**, **Chat**, **Thumbnails**, **Production**, **Help** (you are here), **Admin** (admins only). At the bottom: your profile and sign out. The logo is the folded-broadsheet M.",
        tags: ["nav", "rail", "icons"],
      },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    color: "#7C3AED",
    soft: "#EEE7FC",
    entries: [
      {
        q: "How do I add another YouTube channel?",
        a: "Three ways: (1) the **+ Channel** button in the topbar, (2) the **Channels** entry in the left rail, or (3) the **Manage channels** button. All three open the same onboarding wizard. Each new channel gets its own voice, audience, ideas, scripts, and templates.",
        links: [{ label: "New channel wizard →", href: "/onboarding/channel/new" }, { label: "Manage all channels →", href: "/channels" }],
        tags: ["channel", "add", "switch", "multiple"],
      },
      {
        q: "How do I switch between channels?",
        a: "Use the **Active channel** pill in the topbar — pick from the dropdown and click **Switch**. The whole app then scopes to that channel: Ideas, Scripts, Chat, Thumbnails, etc. all show only that channel's content.",
        tags: ["switch", "active channel"],
      },
      {
        q: "What's Channel Memory?",
        a: "Durable facts the AI applies to **every** script in a channel without you re-explaining. Example entries: \"Always cite original papers, not blog summaries.\" \"Avoid the word 'literally'.\" \"My audience already knows what compounding is.\" Open Channels → pick a channel → **Memory** tab.",
        tags: ["memory", "durable facts"],
      },
      {
        q: "How do I re-link a YouTube channel after I switch handles?",
        a: "Channels → pick channel → **Settings** tab → scroll to **Relink YouTube channel**. Pasting the new handle triggers a fresh voice + audience training run.",
        tags: ["relink", "youtube", "retrain"],
      },
    ],
  },
  {
    id: "voice-audience",
    label: "Voice & audience",
    color: "#E5482F",
    soft: "#FDE7E1",
    entries: [
      {
        q: "How does the AI learn my voice?",
        a: "On linked channels we pull your top 10 videos (5 most-viewed + 5 most-recent ≥ 3 min), pull transcripts, and produce a structured voice profile: archetype, delivery, rhetoric, diction, signature phrases. For custom channels we generate a baseline from your description and improve as you add writing samples.",
        tags: ["voice", "training"],
      },
      {
        q: "Can I borrow another creator's voice?",
        a: "Yes. Channels → Voice → **Borrow a voice** sidebar. Paste any `@handle` — we train a new profile from their transcripts and save it as a separate voice you can pick per script.",
        tags: ["borrow", "voice"],
      },
      {
        q: "Can I have multiple voices in one channel?",
        a: "Yes — add as many profiles as you want; mark one as default. On any script, pick a different voice from the **Voice** dropdown in the Canvas toolbar.",
        tags: ["voice", "multiple"],
      },
      {
        q: "How do I refresh the audience avatar after my channel evolves?",
        a: "Channels → Audience → **Refresh avatar from YT data**. Heads up: this overwrites manual edits.",
        tags: ["audience", "refresh"],
      },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    color: "#15924B",
    soft: "#E0F2E8",
    entries: [
      {
        q: "Canvas or Script Builder — which one?",
        a: "**Canvas** is the chat-driven split-panel default — Plan → Outline → Script with autosave + Highlight-and-Improve + Humanize. Faster.\n**Script Builder Classic** is the 10-step structured workflow (Research → Frame → Title → Thumbnail → Hook → Payoffs → Draft → Edit → Export → Publish). Use it when you want explicit steps.\nSwitch between them with the **Builder mode →** / **Canvas mode →** link in the script toolbar.",
        tags: ["canvas", "builder", "writing"],
      },
      {
        q: "What does Humanize do?",
        a: "Rewrites the script to strip AI patterns, merge choppy sentences, replace abstractions with specifics, target ~6th-7th grade spoken readability, and optimize cadence for AI voiceover — while preserving your voice. Snapshots the pre-Humanize version to history so you can revert.",
        tags: ["humanize", "ai patterns"],
      },
      {
        q: "How do I rewrite just a paragraph without losing the rest?",
        a: "Highlight the text in the Canvas editor → click **Improve** → pick a quick instruction (Tighter / More vivid / Punchier hook / etc.) or type a custom one. Only the selection gets rewritten.",
        tags: ["improve", "highlight"],
      },
      {
        q: "What's the Prompt Library?",
        a: "Press **Ctrl+/** (or ⌘+/) anywhere in chat to open it. 20+ categorized ready-made prompts for ideation, research, writing, structure, packaging. Click any to insert into the composer.",
        tags: ["prompt library", "shortcut"],
      },
    ],
  },
  {
    id: "intel",
    label: "Intel",
    color: "#2563EB",
    soft: "#E5EDFD",
    entries: [
      {
        q: "What does outlier score mean?",
        a: "A video's views ÷ the average views of up to 10 surrounding videos on the same channel. Severity bands: **≥5x exceptional** (red), **2-5x strong** (amber), **1-2x average** (blue), **<1x under** (grey).",
        tags: ["outlier", "score"],
      },
      {
        q: "Can I use advanced search syntax?",
        a: "Yes. Paste tokens like `subs:>100k subs:<1m velocity:>5 engagement:>0.05 views:>1m format:short lang:en` directly in the search box. Tokens are extracted and merged with the visible filter inputs.",
        tags: ["search", "advanced", "syntax"],
      },
      {
        q: "I searched a handle and got no results.",
        a: "If the handle starts with `@` and we don't have it indexed yet, an **Auto-index** button appears in the empty state. One click fetches the channel + 8 videos and adds them to Intel for everyone.",
        tags: ["index", "auto-index"],
      },
      {
        q: "How do I chat about a specific channel or video?",
        a: "Open the channel or video detail page in Intel → **Chat with channel** or **Chat with video** button. Creates a new chat scoped to that entity with the right context pre-attached.",
        tags: ["chat", "intel"],
      },
    ],
  },
  {
    id: "publishing",
    label: "Publishing",
    color: "#15924B",
    soft: "#E0F2E8",
    entries: [
      {
        q: "How do I export a finished script?",
        a: "Open the script → **Publish →** button in the toolbar. The Publish page has Copy to clipboard, Download .docx (real Word file), Download .pdf, and Teleprompter (full-screen play/pause/speed reader).",
        tags: ["export", "docx", "pdf", "teleprompter"],
      },
      {
        q: "Can it write my YouTube description, tags, social posts?",
        a: "Yes. On the Publish page, **Titles & metadata** generates titles, hooks, description, and tags. **Promo / cross-post** generates Twitter thread, LinkedIn post, Instagram caption, newsletter section, blog adaptation, and shot list. Each has its own Copy button.",
        tags: ["promo", "description", "tags", "social"],
      },
      {
        q: "How do I get YouTube chapter timestamps?",
        a: "Publish page → **YouTube chapter markers** section → **Generate chapters**. Returns `MM:SS Title` lines you can paste into your YouTube description.",
        tags: ["chapters", "timestamps"],
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    color: "#4F46E5",
    soft: "#E7E6FB",
    entries: [
      {
        q: "What's in the Reports section?",
        a: "Ten stock reports — Traffic overview, Content performance, Keyword rankings, Pipeline velocity, Autopilot operations, Editorial compliance, Voice & motifs, Social distribution, Video production, and Content audit — plus any custom reports you build. Every number is a real row from your workspace; blocks without data say so instead of drawing a curve.",
        links: [{ label: "Open Reports →", href: "/reports" }],
        tags: ["reports", "analytics", "hub"],
      },
      {
        q: "How do I customize a report?",
        a: "Open any report → **Customize**. Add or remove blocks from the block library (KPI row, trend charts, movers, tables, compliance, and more), reorder them with the arrows, rename the report, and set its date range (4/8/12 weeks). Customizations are saved per workspace. Stock reports keep a **Reset to stock default** button; custom reports can be deleted.",
        tags: ["customize", "blocks", "reorder"],
      },
      {
        q: "Can I export a report for a client?",
        a: "Yes — every report has a **PDF** button. The export contains the same real numbers as the screen, with a data note explaining coverage. Chart-heavy blocks summarize to text in the PDF.",
        tags: ["pdf", "export", "client"],
      },
      {
        q: "How do I build my own report?",
        a: "Reports → **New custom report** → name it. It starts with a KPI row; open **Customize** to add any blocks from the library in any order. It then appears in the hub alongside the stock ten.",
        tags: ["custom report", "builder"],
      },
    ],
  },
  {
    id: "blog",
    label: "Blog workspace",
    color: "#E11D48",
    soft: "#FBDFE6",
    entries: [
      {
        q: "How is the Blog section organized?",
        a: "Blog is a workspace with its own tab strip: **Posts** (the kanban pipeline — cards open the editor), **Ideas** (scored idea board), **Keywords**, **Experts** (SME profiles), **Audit** (existing-content scan), **Analytics**, **Report** (the client-facing monthly report), **Automation** (the autonomy dial), **Brand** (brand kit + the 7 Motifs), **Organization**, and **Settings** (WordPress + publishing). Badges on the tabs show what needs attention.",
        links: [{ label: "Open the blog workspace →", href: "/blog" }],
        tags: ["blog", "workspace", "tabs", "kanban"],
      },
      {
        q: "How does the post editor work now?",
        a: "The editor is split into five tabs — **Write** (title, motif blend, body, versions), **Optimize** (publish prep, internal links, gaps, E-E-A-T), **Assets** (the featured + OG images the publish gate requires), **Distribute** (schedule, WordPress, social variants, video package), and **Review** (checks, citations, comments, reviewer). The **Gates** sidebar on the right shows the publish contract from every tab — if something is blocking, it tells you where.",
        tags: ["editor", "tabs", "gates"],
      },
      {
        q: "Why can't I publish a post?",
        a: "Check the **Gates** sidebar: publishing is blocked until required checks pass — SEO meta present, all citations verified, no [NEEDS SOURCE] markers, descriptive link text, and (by default) an approved featured image + branded OG image at your workspace dimensions. Each failing gate links to the tab where you fix it. Admins can relax the image requirement under Blog → Brand → Asset policy.",
        tags: ["publish", "blocked", "gates", "images", "citations"],
      },
      {
        q: "What are the 7 Motifs?",
        a: "The tone engine. Each motif (Visionary, Competitive, Succinct, Sincere, Exclusive, Social, Informative) is an editable, versioned style directive that steers every generation. Pick a single motif or a weighted blend per post — the strongest weight sets structure and voice, the rest color the intro and CTA. Configure directives, defaults by tier/audience, and per-channel mappings under **Blog → Brand**.",
        links: [{ label: "Brand & motifs →", href: "/blog/brand" }],
        tags: ["motifs", "tone", "voice", "brand"],
      },
    ],
  },
  {
    id: "videos",
    label: "Videos",
    color: "#7C3AED",
    soft: "#EEE7FC",
    entries: [
      {
        q: "How do video storyboards work?",
        a: "Packaging a published post (its **Distribute** tab, or autopilot) creates a 3-4 scene storyboard: each scene has a visual prompt, a duration, and on-screen text — scene 1 is the hook, the last is the CTA. Open any render on the Videos page to edit scenes before rendering. Rendering processes each scene through the provider; captions (SRT) are timed from the scene durations, so they always match the cut.",
        links: [{ label: "Videos →", href: "/videos" }],
        tags: ["storyboard", "scenes", "video"],
      },
      {
        q: "How do I switch from mock video to real (Veo)?",
        a: "Admin → **API keys** → *Media & video*: paste a Google key and set the **Video renderer** to Auto or Veo. Auto uses Veo whenever a key is present; Mock never spends. Real renders count against the daily cap shown on the Videos page, and outputs are persisted to storage because Veo links expire in ~2 days.",
        links: [{ label: "Admin → API keys →", href: "/admin/api-keys" }],
        tags: ["veo", "provider", "mock", "cost"],
      },
      {
        q: "Can it generate a voiceover?",
        a: "Yes — the **Generate voiceover** button on a storyboard reads the scene texts as a narration script. With the mock TTS it stores that script as clearly-labeled text; paste an ElevenLabs key and switch the TTS provider (Admin → API keys) for real audio.",
        tags: ["voiceover", "tts", "elevenlabs", "audio"],
      },
      {
        q: "How do I get ONE video file instead of separate scene clips?",
        a: "A multi-scene board renders one clip per scene. **Assemble full video** (on the storyboard page) stitches them with ffmpeg: every clip is scaled and padded onto one canvas for the render's aspect ratio, then concatenated in scene order. If a real voiceover exists it replaces the soundtrack over the whole cut. Assembly runs automatically as soon as a multi-scene render finishes, and it's re-runnable — do that after regenerating a voiceover. It costs no provider money, only CPU. Captions stay a separate SRT file; they are not burned in.",
        links: [{ label: "Videos →", href: "/videos" }],
        tags: ["assemble", "ffmpeg", "stitch", "concat", "full video", "download"],
      },
      {
        q: "Where are uploads, voiceovers and renders stored?",
        a: "Admin → **API keys** → *Storage*. **Local disk** is the dev default, but on Railway the disk is wiped on every redeploy — files don't survive. **Google Drive** keeps them durably: create a service account, share a Drive folder with it as Editor, paste both in, and the app runs a real write test before switching. Files stay private — they're streamed only to signed-in members, never public-by-link. Note: on a free personal Drive, uploads count against the *service account's own* 15 GB quota (shown live on the Storage card); a Workspace Shared Drive pools quota instead.",
        links: [{ label: "Admin → API keys →", href: "/admin/api-keys" }],
        tags: ["storage", "gdrive", "google drive", "uploads", "railway", "persistence"],
      },
      {
        q: "A render failed — now what?",
        a: "The error is shown on the render (quota, key, or provider issues are the usual causes). Hit **Retry** to re-queue it — the daily cap still applies. Scenes that completed before a mid-storyboard failure are kept.",
        tags: ["retry", "failed", "render"],
      },
    ],
  },
  {
    id: "production",
    label: "Production",
    color: "#0D9488",
    soft: "#D7F1ED",
    entries: [
      {
        q: "How do I turn a script into a tracked project?",
        a: "On any script, click **Track in production →** in the toolbar. Creates a Content Project, drops you on the board, and links the project to the script.",
        tags: ["promote", "project"],
      },
      {
        q: "Where do I see what's being filmed today?",
        a: "Production → **Film Queue**. Projects with status `recording` are grouped by shoot day, with shot-list panels per project.",
        tags: ["film queue", "shoot day"],
      },
      {
        q: "How do team members get assigned?",
        a: "Open a Content Project (click any card) → status + dates + roles + assignees can all be set there. Every list view (Writer's Room, Film Queue, etc.) has a **My work** toggle that filters to projects assigned to you.",
        tags: ["assign", "team"],
      },
      {
        q: "How does the task board work?",
        a: "Production → **Tasks** is a drag-and-drop kanban (To do / In progress / Done). Drag cards between columns, or use the dropdown on each card if you're on touch or keyboard. **In progress** carries a WIP limit — going over turns the counter red. Cards untouched for 3+ days get an amber \"stale\" spine, and overdue dates flag red. The capacity strip below shows open tasks per person.",
        links: [{ label: "Task board →", href: "/production/tasks" }],
        tags: ["tasks", "kanban", "drag", "wip", "capacity"],
      },
      {
        q: "What are auto-created tasks?",
        a: "Pipeline events become work items automatically: a draft parking at review creates a task for the reviewer (due in 2 days), a post reaching approval without its images creates one for the author, and a failed video render creates one for an admin. Each rule can be switched off, and duplicates are never created while an open task with the same title exists. Admins edit the rules (and the WIP limit) at the bottom of the Tasks page.",
        tags: ["auto tasks", "rules", "pipeline"],
      },
      {
        q: "Does the calendar show blog posts too?",
        a: "Yes — Production → **Calendar** is the unified view: content projects by publish date plus scheduled blog publishes (the ✍ entries, which link straight into the post editor).",
        links: [{ label: "Calendar →", href: "/production/calendar" }],
        tags: ["calendar", "unified", "schedule"],
      },
    ],
  },
  {
    id: "team-admin",
    label: "Team & admin",
    color: "#4F46E5",
    soft: "#E7E6FB",
    entries: [
      {
        q: "How do I invite a teammate?",
        a: "Admin → **Users** → enter email + role (Admin / Editor / Viewer) → **Send invitation**. They get an email link; on accept, they join your workspace.",
        tags: ["invite", "team"],
      },
      {
        q: "What can each role do?",
        a: "**Admin** = everything, including user management and workspace settings.\n**Editor** = create/edit scripts, run AI, manage channels, voice, audience, ideas, research.\n**Viewer** = read-only — sees scripts and research but can't generate or edit.",
        tags: ["roles", "permissions"],
      },
      {
        q: "Is there a cost?",
        a: "No. MeYouSocial has no billing, no credits, no payments. AI usage is unmetered for invited members. Admins can optionally set soft monthly limits per user (under Admin → Soft limits) to bound shared infrastructure cost.",
        tags: ["cost", "billing", "limits"],
      },
      {
        q: "How do soft limits work?",
        a: "Admin → Soft limits → set caps for scripts/month, thumbnails/month, agent runs/month, channels per workspace. Leave blank or 0 for unlimited. They're operational guards, never a paywall.",
        tags: ["limits", "caps"],
      },
      {
        q: "Can several companies share one install?",
        a: "Yes — each company lives in its own **workspace** with fully separate content, team, API keys, SMTP and branding. Signing up creates your company's workspace (rename it under Admin → Workspace); invite teammates from Admin. Someone invited to your workspace who signs up via the invite link joins **your** workspace directly. People who belong to several companies get a workspace switcher in the header.",
        tags: ["multi-tenant", "companies", "workspaces", "teams"],
      },
      {
        q: "Whose API keys does my workspace use?",
        a: "Your own, when you've pasted them: everything under Admin → **API keys** (LLMs, search, YouTube, ElevenLabs, video/TTS switches) is saved **per workspace**. If your workspace hasn't set a key, it falls back to the platform's shared key — the card shows which one is in effect. Same for **SMTP**: your notification and invitation emails go out through the server you configure under Admin → Email, visible only to your workspace.",
        links: [{ label: "Admin → API keys →", href: "/admin/api-keys" }, { label: "Admin → Email →", href: "/admin/email" }],
        tags: ["api keys", "smtp", "per-workspace", "tenant"],
      },
      {
        q: "How do I schedule social posts (like Buffer/Hootsuite)?",
        a: "Open **Social** in the sidebar. Pick which connected accounts to post to, write once (a live counter warns when you exceed the tightest network's limit), optionally attach images, then **Post now** or **Schedule** for a future date/time. Scheduled posts publish automatically within about a minute of their time. The queue below the composer shows what's scheduled (grouped by day), your drafts, and history — each post shows per-network status, so if one network fails you can **Retry** just that leg, or **Duplicate** to repost. Connect accounts first under Admin → Connections.",
        links: [{ label: "Open Social →", href: "/social" }, { label: "Admin → Connections →", href: "/admin/connections" }],
        tags: ["social", "schedule", "buffer", "hootsuite", "posting", "queue", "calendar"],
      },
      {
        q: "How do we send email and post to social?",
        a: "Admin → **Connections**. Connect your workspace's own mailbox (Gmail, Outlook, or any IMAP) and social profiles (LinkedIn, Instagram, X) through a guided pop-up — no passwords are stored in the app. Email notifications then send from your connected mailbox over HTTPS (this is the reliable path — the server blocks direct SMTP), and blog social variants gain a **Post now** button on the Distribute tab that publishes to the matching connected profile. Each company connects its own accounts; nothing is shared. A default account per type is used when you have more than one.",
        links: [{ label: "Admin → Connections →", href: "/admin/connections" }],
        tags: ["email", "smtp", "social", "posting", "unipile", "connections", "linkedin"],
      },
      {
        q: "Where do we set our company's brand, personas and topics?",
        a: "**Brand** in the sidebar — your workspace's identity in one place: brand colours and fonts (used in generated content), the app's own accent + logo, company info that grounds every AI draft, **Topics** (the themes you publish about), plus live summaries and links for personas, keywords and connected social accounts. All of it is per workspace, so each company on this install keeps its own. Tone of voice (the 7 Motifs) and asset policy stay under Blog → Brand.",
        links: [{ label: "Open Brand →", href: "/brand" }],
        tags: ["brand", "identity", "personas", "topics", "company", "colors", "keywords"],
      },
      {
        q: "Where can I use Topics?",
        a: "A topic you add under **Brand** is available on every content surface: **channel ideas**, **blog ideas**, **blog posts**, **videos**, **production projects** and **social posts**. Two things make them more than labels:\n\n· **They steer ideation** — on the blog Idea board you can focus a discovery run on one topic, and every idea it generates belongs to that topic. In the social composer, the chosen topic's related phrases appear as click-to-insert chips.\n\n· **They follow the work** — promoting an idea to a draft carries the topic onto the post, and packaging that post into a video carries it again, so you set it once at the start.\n\nDeleting a topic is safe: it clears the tag from anything using it and never deletes your content. Tasks don't have their own topic — they inherit their project's.",
        links: [{ label: "Manage topics →", href: "/brand" }],
        tags: ["topics", "themes", "ideation", "tagging", "content"],
      },
      {
        q: "Can we use our own logo and colors?",
        a: "Admin → **Workspace** → *Branding*: pick an accent color (presets or any hex) and upload a logo. The whole app chrome — buttons, active states, sidebar mark and menu — re-tints for members of your workspace only; other companies keep their own look. Note this styles the **app**; the brand used in generated blog content lives separately under Blog → Brand.",
        links: [{ label: "Admin → Workspace →", href: "/admin/settings" }],
        tags: ["branding", "logo", "colors", "accent", "personalization"],
      },
    ],
  },
  {
    id: "appearance",
    label: "Appearance & shortcuts",
    color: "#6D28D9",
    soft: "#EDE7FB",
    entries: [
      {
        q: "How do I switch to dark mode?",
        a: "Profile (left rail bottom) → **Appearance** → choose Light, Dark, or Auto (follows your OS). Saves immediately.",
        tags: ["theme", "dark mode", "light mode"],
      },
      {
        q: "What's the LIVE ticker in the header?",
        a: "Real activity from your workspace — autopilot drafts, publishes, queued social variants, render results — scrolling in the top bar. Hover to pause it; click any item to jump to that post. It refreshes every minute and only ever shows events that actually happened. Under reduced-motion it holds still with the newest event visible.",
        tags: ["ticker", "live", "activity", "header"],
      },
      {
        q: "How do I make everything on screen bigger?",
        a: "Profile → Settings → **Content size** — Standard, Large, or Extra large. It scales the whole interface (text, buttons, charts) instantly.",
        tags: ["size", "zoom", "accessibility", "large text"],
      },
      {
        q: "What keyboard shortcuts exist?",
        a: "**Ctrl/⌘+/** — Open the Prompt Library in chat.\n**Esc** — Close any modal (Prompt Library, Improve dialog).\nForm fields support Tab and Shift+Tab as expected.",
        tags: ["shortcuts", "keyboard"],
      },
    ],
  },
];

export type Theme = "light" | "dark" | "auto";
