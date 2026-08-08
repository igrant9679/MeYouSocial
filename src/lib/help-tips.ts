/**
 * Hover-help text, in one place.
 *
 * Rendered by <HelpTip> / <WithTip> on the surfaces themselves, and reused by
 * the Help centre so a tooltip and its FAQ answer can never drift apart. Keep
 * each one to a sentence or two — this is the "what is this and why would I
 * touch it" layer, not documentation. Anything longer belongs in `help.ts`.
 *
 * ⚠ Describe what the app ACTUALLY does. A tooltip that overstates a feature is
 * worse than no tooltip: it's the one thing a confused user will believe.
 */

/** What each left-rail module is for, keyed by href. */
export const NAV_TIPS: Record<string, string> = {
  "/dashboard": "Your starting point: what's in flight, what needs attention, and the numbers behind it.",
  "/channels": "One YouTube channel per entry. Each carries its own voice, audience, ideas and scripts — switch channels and the whole app follows.",
  "/intel": "Research: pull in other people's videos and find the outliers — the ones that beat their own channel's average.",
  "/ideas": "Video ideas for the active channel, each traceable back to the competitor video that inspired it.",
  "/scripts": "Long-form scripts. Open one to write with the AI, or run the agent end to end.",
  "/blog": "The article workspace — drafting, SEO, images and publishing to WordPress. Separate from video scripts.",
  "/reports": "Build a report from your own data and export it as a PDF.",
  "/insights": "What actually happened after you published: engagement, search and traffic, once those are connected.",
  "/videos": "Turn a post or idea into a rendered video. Packaging first, then rendering.",
  "/social": "Compose once, post to your connected social accounts — now, at a time you pick, or into a recurring slot.",
  "/brand": "The things every generation should obey: colours, logo, company info, topics, personas and tone.",
  "/chat": "A general assistant with your channel's context already loaded.",
  "/thumbnails": "Thumbnail concepts and images for a video.",
  "/production": "A board for the work itself — who's doing what, and what's blocked.",
  "/help": "Guides, FAQs and search. Start here if you're new.",
  "/admin": "Keys, connections, team, limits and usage. Most one-time setup lives here.",
};

/** Social composer + scheduler. */
export const SOCIAL_TIPS = {
  postTo:
    "Pick which connected accounts this goes to. One post fans out to all of them, and each keeps its own status afterwards.",
  topic:
    "Optional. Tagging a post with a Topic is what lets Reports and Insights group it with everything else on that theme.",
  text: "The shared copy. Every selected network uses this unless you give that network its own version below.",
  addImage:
    "Attached to every network by default. Instagram, Pinterest, YouTube, TikTok and Snapchat cannot post without one.",
  customize:
    "Give this one network its own text and image. Useful when X's 280 characters won't hold what LinkedIn should say.",
  charCount:
    "Characters against that network's own published limit. Over the limit and the app won't let you send.",
  needsImage:
    "This network can't accept a text-only post. Attach an image or deselect it — saving will be refused otherwise.",
  postNow: "Sends immediately to every selected account.",
  schedule: "Sends once, at a date and time you pick.",
  queue:
    "Drops this into the next free slot on your posting schedule, so you never pick a time by hand.",
  slots:
    "Your recurring posting times, e.g. 09:00 Mon–Fri. Stored as wall clock in your workspace timezone, so 09:00 stays 09:00 across daylight-saving changes.",
  utm:
    "Off by default. When on, links get utm_* tags at send, per network — that's what lets analytics tell a LinkedIn click apart from an X one. Links you've already tagged yourself are left alone.",
  perNetworkStatus:
    "Each account's leg is tracked separately, so one network failing doesn't hide the others succeeding.",
  campaign:
    "Group this post into a named series. A campaign can carry its own utm_campaign tag, so analytics can report the series as a series.",
  slotCategory:
    "Route this post to slots of one category (e.g. 'tips' every Tuesday). It falls back to a general slot if its category has none free — nothing ever strands.",
  evergreen:
    "Once this post has gone out, the scheduler may clone it back into a free queue slot after the cooldown — if evergreen auto-fill is switched on below. Clones appear in the queue like any scheduled post and can be edited or cancelled.",
  approvalWorkflow:
    "When on, posts by non-admins are held as drafts until an admin approves them. Nothing unapproved can be sent, scheduled, queued or dragged onto the calendar.",
  evergreenFill:
    "When on, free queue slots in the next 7 days are automatically refilled with eligible evergreen posts. Off by default — automatic posting should never be a surprise.",
  csvImport:
    "One post per row: text, optional scheduledAt, networks, campaign, category, evergreen. Rows import text-only; the auto-image setting then generates a picture for each in the background.",
  autoImage:
    "Posts composed without an image get one generated automatically by the workspace's image provider. Your own attachment always wins, and the mock provider never fakes it — no key means no image, visibly.",
};

/** Ideas / Intel — where the numbers come from. */
export const IDEA_TIPS = {
  outlier:
    "How far the competitor video that inspired this idea beat its own channel's average views. Measured, not estimated — a dash means we have no measurement, never a zero.",
  intelIndex:
    "Add a channel by @handle or search a keyword. What's indexed here is public YouTube metadata, shared across workspaces.",
  competitors:
    "The channels an idea's outliers are measured against. Getting these right is what makes the numbers meaningful.",
};

/** The channel sub-nav. Most of these names mean nothing until you've opened
 *  them once, which is exactly the case hover help is for. */
export const CHANNEL_TAB_TIPS: Record<string, string> = {
  "": "This channel at a glance — recent ideas, scripts and stats.",
  "/ideas": "Video ideas for this channel, each carrying the measured outlier of the competitor video that inspired it.",
  "/scripts": "Every script for this channel. Open one to write with the AI or run the agent over it.",
  "/audience": "Who this channel is talking to, inferred from its own videos. Generations use it for level and framing.",
  "/competitors": "The channels your outliers are measured against. Add by @handle, or search if you don't already know who they are.",
  "/voice": "How this channel sounds, trained from its own titles and descriptions. It says so plainly when it hasn't been trained.",
  "/templates": "Reusable script structures — the built-in ones, plus any you clone from a video you like.",
  "/memory": "Durable facts the AI applies to every script here, so you never re-explain them.",
  "/research": "Multi-source research saved as reports. Star an item to keep it available across every script.",
  "/submissions": "A public form anyone can use to suggest topics. Review what comes in and promote the good ones to Ideas.",
  "/settings": "This channel's name, model, YouTube link and accent colour.",
};

/** Channel setup. */
export const CHANNEL_TIPS = {
  voice:
    "How you sound, learned from your own channel's titles and descriptions. If it hasn't been trained it says so rather than guessing.",
  audience:
    "Who you're talking to, inferred from the same source. Generations lean on this for level and framing.",
  memory:
    "Durable facts the AI applies to every script in this channel, so you don't re-explain them each time.",
  defaultModel:
    "Which AI model this channel drafts with. Falls back to the workspace default when unset.",
};

/**
 * Blog sub-nav, keyed by href.
 *
 * ⚠ These are rendered as native `title` attributes, NOT as <WithTip> bubbles.
 * The strip is `overflow-x-auto` (11 tabs, it scrolls), and an overflow
 * container clips absolutely-positioned children — a bubble would be cut off
 * or invisible. A native tooltip escapes the clip. It's slower to appear and
 * can't be styled, which is the trade for working at all here.
 */
export const BLOG_TAB_TIPS: Record<string, string> = {
  "/blog": "Every article, at whatever stage it's reached. The badge counts the ones waiting on you.",
  "/blog/ideas": "Article ideas waiting to be approved into drafts.",
  "/blog/keywords": "The phrases you're targeting, grouped into clusters — labelled by intent, with no invented search volumes.",
  "/blog/experts": "Subject-matter expert profiles, so a draft can be written in a named person's voice and credentials.",
  "/blog/audit": "Existing content flagged for refresh or repair.",
  "/blog/analytics": "Search and traffic for published articles. Needs Search Console and GA4 connected.",
  "/blog/report": "A client-ready summary you can export.",
  "/blog/automation": "How much the app may do unattended, per function — and the global pause that stops all of it.",
  "/blog/brand": "Tone of voice (the 7 Motifs) and the image policy that gates publishing.",
  "/blog/organization": "Company details that ground drafts in who you actually are.",
  "/blog/settings": "WordPress connection and publishing options.",
};

/**
 * Social sub-nav, keyed by href.
 *
 * ⚠ Native `title`, not bubbles — same `overflow-x-auto` clipping reason as
 * BLOG_TAB_TIPS above.
 */
export const SOCIAL_TAB_TIPS: Record<string, string> = {
  "/social": "The command centre: what's connected, what's due, and what's asking for a decision.",
  "/social/compose": "Write a post, tailor it per network, and send it now, on a date, or into the next free slot.",
  "/social/calendar": "Everything scheduled and drafted, on a grid you can drag. Agenda view lists the same by day.",
  "/social/approvals": "Posts held for review. Nothing here can be sent until an admin approves it.",
  "/social/engage": "Direct messages and comments Zernio can read. Facebook and Instagram have both; LinkedIn has comments only; X exposes no inbox at all.",
  "/social/performance": "What went out, per network, and the engagement pulled back from each.",
  "/social/settings": "Posting schedule, link tagging, campaigns and how much the app may do unattended.",
};

/**
 * Production sub-nav, keyed by href.
 *
 * ⚠ Native `title`, not bubbles — that strip is `overflow-x-auto` too. Same
 * clipping reason as BLOG_TAB_TIPS above.
 *
 * The first four are the same projects at different stages, not four separate
 * tools, which is the thing that isn't obvious from the names.
 */
export const PRODUCTION_TAB_TIPS: Record<string, string> = {
  "/production": "Every project on one board, arranged by the stage it's reached. Start here.",
  "/production/writers-room": "Just the projects being researched and written, with what's due soon and who has it.",
  "/production/film-queue": "Just the projects at the recording stage, grouped by shoot day.",
  "/production/edit-bay": "Just the projects being edited, on their own board.",
  "/production/calendar": "The same work laid out by date instead of by stage.",
  "/production/tasks": "Individual to-dos rather than whole projects — with a work-in-progress limit, ageing flags and per-person capacity.",
  "/production/assets": "A shared B-roll and shot-list library you can reuse across channels.",
  "/production/swipes": "Saved visual references — thumbnails, set design, landing pages — to borrow from later.",
  "/production/wiki": "Your own process docs and SOPs, so how-we-do-it lives with the work.",
};

/** Videos. */
export const VIDEO_TIPS = {
  provider:
    "Which engine renders scenes. “mock” costs nothing and produces a stand-in clip rather than a real render — useful for trying the flow, misleading if you think it's finished footage.",
  budget:
    "Every scene render counts against today's cap, including re-runs. The spend figure is an estimate, not a bill.",
  brandedShort:
    "A short vertical title card built from this workspace's brand colours, straight from a headline — no blog post needed.",
};

/** Reports. */
export const REPORT_TIPS = {
  reports:
    "Pre-built reports you can rearrange block by block. Blocks with no data say so rather than showing a zero, so an empty block means the data isn't there yet.",
  custom: "Built by you from scratch, rather than one of the stock reports.",
  customized: "A stock report whose blocks you've since changed.",
};

/** Chat. */
export const CHAT_TIPS = {
  chat:
    "A conversation with your channel's voice, audience and memory already loaded, so you don't have to re-explain the channel each time. Good for thinking out loud before committing to a script.",
  scoped:
    "Chats belong to the channel that was active when you started them — switch channels and you'll see that channel's chats instead.",
};

/**
 * Blog post editor tabs, keyed by tab key.
 *
 * ⚠ Native `title` again — the editor's tab strip is `overflow-x-auto`.
 */
export const BLOG_EDITOR_TAB_TIPS: Record<string, string> = {
  write: "The draft itself — outline, body, and the AI writing tools.",
  optimize: "Title, meta description, keywords, internal links and readability. The SEO pass.",
  assets: "The featured and social images this post needs before it's allowed to publish.",
  distribute: "Where it goes once it's live — social variants, and packaging it as a video.",
  review: "The publish gates and the content score. A post can't advance until the required checks pass.",
};

export const BLOG_EDITOR_TIPS = {
  gates:
    "Deterministic checks — SEO, accessibility, readability, citations — re-run on the server every time a post tries to advance. They can't be clicked past, and unverified citations can never publish unattended.",
  score:
    "A guide, not a gate. It's computed from the post itself, not from how it ranks — nothing here has seen a search result.",
};

/**
 * Image generation IS wired now — `gpt-image-1` or `gemini-3.1-flash-image`, per
 * the `image:provider` setting. `notWired` below is therefore CONDITIONAL copy:
 * only render it where `resolveImageProviderName()` actually returns "mock".
 *
 * It used to be unconditional, because `lib/images` resolved to the mock on both
 * branches of its ternary and every "generated" image was a picsum stock photo.
 * That is the most misleading failure shape available — it doesn't look like a
 * placeholder, it looks like a real result — which is why the warning exists at
 * all, and why it must disappear once a real provider resolves. A stale "this is
 * fake" notice sitting over genuine renders is its own kind of lie.
 */
export const IMAGE_TIPS = {
  notWired:
    "Image generation isn't connected yet, so this returns a random stock photo rather than a real thumbnail — a placeholder to lay out against, not something to publish.",
  brainstorm:
    "Writes four thumbnail concepts as text — the angle, the framing, the words on screen. The concepts are real; the pictures beside them are stock placeholders.",
  clone:
    "Fetches the reference image and has a vision model actually look at it — palette, the words on screen, the crop — then renders your title in that style. Works with a YouTube link or a direct image URL; an @handle can't be opened, and you'll be told when it fell back to the title alone.",
  history: "Everything this channel has generated, newest first.",
};

/** Brand. */
export const BRAND_TIPS = {
  topics:
    "Themes that run across everything — social posts, blog posts, ideas, videos and production projects can all be tagged with one.",
  motifs:
    "Seven tone directives blended per piece. They're editable rows, not fixed prompt text, so changing one changes every future generation.",
  guardrails: "Rules every generation must obey — the things you never want said, however it's phrased.",
};

/** Admin / setup. */
export const ADMIN_TIPS = {
  apiKeys:
    "The AI provider keys this workspace generates with. Each company brings its own — keys are never shared between workspaces.",
  mockWarning:
    "With no working key, generations silently fall back to placeholder text instead of failing. If output looks generic, check here first.",
  connections:
    "Social accounts, mailboxes and storage. Anything connected in a provider's own dashboard needs a Refresh here to be claimed by this workspace.",
  refresh:
    "Pulls in accounts that already exist upstream and attaches them to the workspace named on the button. Check which workspace is active first.",
  storage: "Where uploaded images and video live. Without it, files don't survive a redeploy.",
  analytics:
    "Search Console and GA4. Both need the API enabled on the Google Cloud project AND the service account granted access — a missing grant and a disabled API look identical otherwise.",
  workspace:
    "The company you're currently working as. Everything scoped — keys, accounts, content, team — follows this switcher.",
};
