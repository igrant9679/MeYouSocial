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
