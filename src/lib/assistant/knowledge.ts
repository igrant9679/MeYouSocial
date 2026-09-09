/**
 * What the assistant KNOWS about the app it lives in — the operator's guide,
 * in topics it can look up. Kept as plain data so the Help Center and the
 * assistant never disagree: when the app changes behaviour, change this file
 * (and the matching help entry) in the same commit.
 *
 * Two surfaces read it:
 *   · `APP_MAP_BRIEF` goes into every assistant turn's system prompt (short,
 *     so it costs little) — the shape of the app and where things are.
 *   · `appGuide(topic)` is a read-only tool the assistant calls when a person
 *     asks HOW to do something or WHY something is held — the full text of
 *     one topic, so the answer is the app's own rather than a guess.
 */

export const APP_MAP_BRIEF = `MeYouSocial is one loop: Research → Ideas → Drafts → Review → Publish → Distribute → Measure, with Inbox above it (everything waiting on a person, the action on each card) and Setup below it (Settings · Channels · Brand · Admin; admins only). The assistant (you) is on every page as the Ask dock and can do nearly everything a person can; outward-facing acts are proposed and run on a yes. Every page a stage owns shows a strip: STAGE · Overview · its tabs, with count badges (red = a person must act).
Stages and tabs: Research (Intel, Bookmarks, Competitors) · Ideas — one board for article and video ideas, four columns Discovered/Approved/Drafted/Rejected (tabs Keywords, Experts) · Drafts (Articles, Board; Scripts, Thumbnails, Videos, Production when the video studio is on) · Review (Approvals, Audit) · Publish (Website, Blog calendar; Download HTML and Mark as published when there is no WordPress) · Distribute (Compose, Calendar, Engage) · Measure (Reports, Insights, Blog analytics, Blog report, Social performance) · Settings by question: People (roles, invitations, require approval), Automation (full autonomy, pause, weekly article target, publish day, SEO on drafts, social auto-dials, function modes), Schedule (slots, timezone, best time, UTM, campaigns), Connections (what is connected and what is missing) · Brand (Tone & motifs, Organization).
The engine: a 30-minute autopilot sweep discovers ideas, drafts APPROVED ideas up to the weekly target, fills SEO, renders and vision-reviews images, sources [NEEDS SOURCE] claims by live search, applies mechanical findings, advances articles that pass every required check, publishes on the publish day, writes and queues social posts, recycles evergreen, syncs results. Required checks: meta title, meta description, slug, focus keyword in title, a body, alt text on images, no unresolved [NEEDS SOURCE] markers, every citation verified, a branded Open Graph image. What still stops a post: a claim no source supports, an image that keeps failing inspection, no WordPress connection, no working AI key. Article statuses: drafting → draft_review → final_approval → published. Idea statuses: discovered → approved → drafted (only approved ideas are drafted; approving is a person's act). Silence means all clear: the digest emails admins only when something needs them.`;

export type GuideTopic = { id: string; title: string; keywords: string[]; body: string };

export const APP_GUIDE: GuideTopic[] = [
  {
    id: "map",
    title: "The app, page by page",
    keywords: ["where", "page", "rail", "strip", "tabs", "navigation", "find", "menu", "inbox", "stage"],
    body: `Rail, top to bottom: Inbox (landing page: cards for posts awaiting approval, questions only you can answer, claims with no source, images that need your eye, articles held at review, invitations — then the pipeline beneath) · Assistant (also the Ask dock top-right on every page, Ctrl+/) · Research · Ideas · Drafts · Review · Publish · Distribute · Measure · Setup group (Settings, Channels, Brand, Admin — admins only) · Help.
Each stage page has an Overview (its own rows with the verb on the row) and tabs to the module pages, which kept their URLs: Research → /intel, /intel/bookmarks, /channels/<id>/competitors (the old /chat is the assistant). Ideas → /ideas is the one board; tabs /blog/keywords, /blog/experts. Drafts → /blog (articles), /blog/board, and when the video studio is on /channels/<id>/scripts, /thumbnails, /videos, /production. Review → /social/approvals, /blog/audit. Publish → /website, /blog/calendar. Distribute → /social/compose, /social/calendar, /social/engage. Measure → /reports, /insights, /blog/analytics, /blog/report, /social/performance. Settings → /setup with People, Automation, Schedule, Connections. Brand → /brand, /blog/brand (tone & motifs), /blog/organization.
Old links still work: /dashboard → Inbox; /blog/ideas and a channel's ideas → the board; /blog/automation → Settings → Automation; /social/settings → Settings → Schedule; /social → Distribute. Personal settings (theme, text size, profile) are under /settings, not the workspace's Settings.`,
  },
  {
    id: "daily",
    title: "The daily routine (about five minutes)",
    keywords: ["daily", "today", "every day", "morning", "routine", "what should i do", "attention", "needs me"],
    body: `1. Read the digest if one arrived — it lists exactly what needs you. No digest means nothing urgent.
2. Open the Inbox and work it top to bottom: approve or request changes on social posts (admin); answer questions in your own words — only what you would stand behind if quoted (answers are saved to the Experts profile and asked once); verify a claim with a URL that genuinely supports it, or drop it; approve or replace a held image; open an article held by a check only a person can fix. The header count should reach zero.
3. Distribute → Engage: answer comments and DMs the day they arrive. Facebook and Instagram DMs can only be answered within 24 hours of the person's message — the one hard deadline in the app.
4. Glance at the strip's badges as you pass through stages: red means a person's job.
Ask me "what needs my attention?" and I will read the same data and can do the next step — draft the idea, fill the missing SEO — while leaving every result at the gate you review it from.`,
  },
  {
    id: "weekly",
    title: "The weekly routine (about thirty minutes, best the day before the publish day)",
    keywords: ["weekly", "week", "this week", "triage", "plan", "publish day", "wednesday"],
    body: `1. Ideas: triage Discovered — approve what is worth writing, reject the rest. Only approved ideas are drafted; an empty Approved pool means no new articles whatever the dial says. Keep three to five approved.
2. Drafts → Board: read what arrived — words, images and SEO together — and fix only what auto-review could not. In the article's Optimize tab, answer the knowledge cards, decide the strategic ones; mechanical ones apply on their own.
3. Review → Approvals, then Distribute → Calendar: approve the social week and make sure approved drafts are queued into slots. An approved draft that was never queued never sends (turn on "queue on approval" under Settings → Automation to collapse the two).
4. Publish: confirm the article due on the publish day is at final approval. With no WordPress, Download HTML, add it to the site, then Mark as published with the live URL.
5. Measure → Social performance, and the best-time-to-post section under Settings → Schedule once enough posts are measured.
6. Research: skim the strong outliers; turn one into an idea if it fits a Topic.`,
  },
  {
    id: "monthly",
    title: "The monthly routine (about an hour, admin)",
    keywords: ["monthly", "month", "review", "tune", "dials", "quotas", "strategy"],
    body: `1. Insights and Reports: what ranked, what got clicked, which networks earned their place. Decide what to do more of.
2. Brand → Tone & motifs: adjust Motif weights, retire topics that ran dry, add what the numbers say is working; refresh the AI brand context (differentiators, products, documents — never AI-written).
3. Settings → Automation: raise the weekly article and social targets if review has been consistently easy; lower anything producing more than can be honestly reviewed; consider evergreen recycling once there is a body of posts worth resurfacing.
4. Settings → Connections: everything the loop needs still connected; provider billing; analytics still pointing at the right properties.
5. Settings → People: joiners, leavers, pending invitations.
6. Review → Audit: run a content audit and act on the refresh / merge / retire recommendations.`,
  },
  {
    id: "autopilot",
    title: "What the autopilot does every sweep",
    keywords: ["autopilot", "sweep", "cycle", "automation", "autonomy", "full autonomy", "runs by itself", "unattended", "pause", "modes"],
    body: `Every 30 minutes, per workspace and in this order: ideation tops up the Discovered pool when it is below three · drafting consumes Approved ideas up to the weekly article target (rolling seven days) and the daily AI budget (20 generations) · social variants and video storyboards for published articles where those modes allow · auto-review on every article at review: fill empty SEO (never overwriting hand-tuned metadata), render missing images, have a vision model look at every pending AI image (approve, or regenerate; after two rejections it stops spending and tells a person), source every [NEEDS SOURCE] claim through live web search with a judge that demands real support (an unsourceable claim is held and retried at most once a day), generate findings once and apply the mechanical ones · advance any article that passes every required check to final approval · publish articles at final approval on the publish day in the posting timezone (a date set by hand is always honoured) · social: write posts from Topics up to the weekly quota, claim free slots, recycle evergreen, sync engagement and account health.
Full autonomy (Settings → Automation; confirm by typing AUTONOMOUS) sets ideation, drafting, social and publishing to auto and turns queue-on-approval on, remembering the previous dials so switching off restores them. Global pause blocks every AI action, clicks included. Function modes: manual (AI acts only on clicks), assisted (AI runs the work, queues at a human checkpoint), auto (unattended). An idle sweep leaves no trace — that is not a dead scheduler.`,
  },
  {
    id: "gates",
    title: "The gates: what must be true before an article moves",
    keywords: ["gate", "checks", "held", "stuck", "final approval", "why isn't", "blocked", "requirements", "seo", "alt text", "citation"],
    body: `Required (an article cannot reach final approval or publish until all pass): meta title present and ≤ 60 characters · meta description present and ≤ 155 · URL slug set (lowercase, hyphenated) · focus keyword in the title or meta title · a draft body · alt text on every image · no unresolved [NEEDS SOURCE] markers · every citation verified · a branded Open Graph image (1200×630) and a featured image attached and approved.
Optional (shown, never blocking): focus keyword in the body, heading levels don't skip, length near the template target, readability ≥ 50, no generic filler, grounded in an expert profile.
The Inbox's "Articles held at review" card names the failing required check. Under full autonomy the app does the review work itself and only holds what it cannot fix.
A person outranks the checks. Any clearing act — answering or dismissing a question, verifying or dropping a claim, approving an image — re-runs the checks at once and moves the article to final approval the moment they pass, not on the next sweep. And an admin can override: the held card's "Advance anyway" (with an optional reason) records who, when and why on the article and in the audit log, moves it to final approval now, and carries through the sweep and publishing so it does not stall a step later. Dismissing a question alone moves the article only if that question was the last thing holding it; otherwise the card still names the failing check, and Advance anyway is the override.`,
  },
  {
    id: "claims",
    title: "Claims, sources and [NEEDS SOURCE]",
    keywords: ["citation", "source", "needs source", "claim", "verify", "unsourced", "drop the claim", "search"],
    body: `Drafts flag every statement the writer could not stand behind with a [NEEDS SOURCE] marker and a citation row for its sentence. Auto-review searches the live web for each (a real search key — Tavily or Serper — is required; nothing is ever verified on a mock's word) and asks a judge whether a result genuinely SUPPORTS the claim — topical overlap is not support, and a source that contradicts it is the opposite. A supported claim gets its marker replaced by a source link. An unsupported one is held: the Inbox shows a "Claims with no source" card with Verify (paste a URL that supports it) and Drop the claim (removes the marker and the record; the sentence stays — edit it in the article if it should go). A held claim is retried at most once a day until a person acts.`,
  },
  {
    id: "images",
    title: "Images: generation, review and the brake",
    keywords: ["image", "images", "picture", "featured", "og", "open graph", "render", "rejected", "vision", "brake"],
    body: `Every article gets a featured image and an Open Graph image (1200×630, branded) from an art-direction brief that uses the brand kit's specs and the workspace's real brand name. AI renders land as pending. Under full autonomy a vision model looks at each render for concrete defects — cut-off text, garbled lettering, an invented brand name, watermarks, glitches — and approves only what passes; a failed render is regenerated once, and after two rejections the brake stops spending and the Inbox shows "Images that need your eye" with Approve and "Pick or upload instead". An unchanged rejected render is judged once, not every sweep. Your own uploads always win over generated images. Provider: gpt-image-1 or a Gemini image model, chosen under Admin → API keys; a mock provider attaches nothing rather than faking it.`,
  },
  {
    id: "social",
    title: "Social: slots, approval, queueing, evergreen, engage",
    keywords: ["social", "post", "slot", "schedule", "queue", "approval", "evergreen", "campaign", "utm", "linkedin", "facebook", "instagram", "x", "engage", "dm"],
    body: `Posting slots (Settings → Schedule) are the recurring send times, wall-clock in the workspace's timezone so 09:00 stays 09:00 through daylight-saving changes. A queued post claims the next free slot in its category (own → general → any). Require approval (Settings → People) holds every post by a non-admin until an admin approves it; nothing unapproved can be sent, scheduled, queued or dragged. Queue on approval (Settings → Automation) drops an approved post into the next free slot, making approval the last human act. Auto-generate posts writes n a week from your Topics, each with an auto-image, queued into free slots or held for approval. Evergreen auto-fill refills free slots in the next seven days with eligible posts after their cooldown (opt-in). Campaigns carry their own utm_campaign; link tagging uses the network as the source so analytics can tell LinkedIn traffic from X traffic. Distribute → Engage holds comments, DMs and reviews; Facebook and Instagram DMs can only be answered within 24 hours. Accounts connect under Connections with this app's own Connect buttons, not the provider's dashboard; an account is "in trouble" only on the provider's own verdict — a token-expiry note alone is informational.`,
  },
  {
    id: "publish",
    title: "Publishing, the publish day, and publishing without WordPress",
    keywords: ["publish", "publishing", "wordpress", "website", "html", "export", "download", "mark as published", "publish day", "live"],
    body: `An article at final approval publishes on the publish day (Settings → Automation; empty = any day) in the posting timezone when publishing is on auto, or when an admin presses Publish now. A date set on the article by hand is always honoured. With WordPress connected (Publish → Website), publish means publish — the status only flips when the site accepted the post. With no WordPress, articles park at final approval: use Download HTML on the Publish stage (a self-contained file with the meta title, description, canonical, Open Graph tags and the images embedded; add ?fragment=1 for just the article body), add it to any site, then Mark as published with the live URL so social variants, analytics and the board move on. For social previews, upload the Open Graph image to the site and point og:image at its public URL — crawlers ignore embedded images.`,
  },
  {
    id: "ideas",
    title: "The Ideas board",
    keywords: ["idea", "ideas", "board", "approve idea", "discover", "priority", "video idea", "keyword", "expert"],
    body: `One board for article and video ideas: Discovered (waiting for a yes or no) → Approved (next to be written) → Drafted (an article or script exists) → Rejected. A format chip marks each card. Article ideas: Approve, Reject, Send to draft (draft now instead of waiting for the sweep), edit tags (angle, keyword, audience, tier, target page, seasonal hook, motif weights), merge into another idea, delete. Video ideas: Approve, Reject, Write (opens the script canvas), set topic, open the detail, delete. Add one with the form (Article, or Video on a channel); Discover article ideas runs discovery (optionally focused on a Topic); Generate 10 video ideas runs the channel's idea pipeline; Recompute priorities rescoring uses your keyword strategy, page map and published archive — every score shows its working on the card. Only approved article ideas are drafted, and approving is a person's act by design.`,
  },
  {
    id: "research",
    title: "Research: Intel, outliers, bookmarks, and talking it through",
    keywords: ["research", "intel", "competitor", "outlier", "youtube", "bookmark", "transcript", "chat with video", "ask about", "analyze", "remix", "script"],
    body: `Intel indexes public YouTube channels by @handle or keyword and measures each video's outlier score — its views divided by its own channel's average: 5× or more is exceptional, 2× strong, 1× average; a dash means no measurement, never zero. The Research overview lists the strong outliers with "Make it an idea", which adds an article idea to the board. Bookmark the videos worth keeping. Open a channel or a video and press Ask about this channel / video: the assistant (me) reads its stats, outliers and transcript and thinks it through with you — why it worked, the hook, the structure, how to remix it for your channel — and turns the conversation into a script on the canvas when you say so. Paste any YouTube or web link into me for the same; the paperclip attaches a file as research on your channel. I carry the active channel's niche, audience, voice and memory. (The Research → Chat tab was folded into me on 2026-09-09.) A channel's Competitors tab is the set its outliers are measured against — getting that right is what makes the numbers meaningful.`,
  },
  {
    id: "settings",
    title: "Settings, by question",
    keywords: ["settings", "setup", "dial", "configure", "people", "automation", "schedule", "connections", "roles", "invite", "studio"],
    body: `Who can do what — Settings → People: members and roles (admin approves, publishes and configures; editor writes and proposes; viewer reads), invitations with the join link, and whether social posts need an admin's approval. Publishing an article is always an admin's act.
What runs by itself — Settings → Automation: full autonomy, global pause, autopilot status and Run cycle now, the weekly article target and publish day, SEO with every draft, the social auto-dials (queue on approval, evergreen, auto-image, auto-generate n a week with an optional campaign), and the function modes.
When things go out — Settings → Schedule: posting slots and timezone, measured best time to post, link tagging, campaigns.
Keys and connections — Settings → Connections: one row per thing the loop needs (AI keys, live search, images, video, voice, shorts, YouTube, channels, social accounts, mailbox, WordPress, analytics, storage), connected or not, each linking to the page that fixes it.
Brand and voice — Brand: company info, the seven Motifs, the brand kit and image specs, the AI brand context, and the experts the writing quotes.
Video studio — a switch on the Settings overview: Scripts, Thumbnails, Videos and Production show under Drafts only when a YouTube channel exists and it is on; nothing is deleted by turning it off.`,
  },
  {
    id: "onboarding",
    title: "Setting a workspace up from zero",
    keywords: ["onboard", "new workspace", "setup from scratch", "first", "start", "getting started", "install"],
    body: `In order: Admin → API keys (paste an AI provider key; set the default model to match; keys are per workspace) → Settings → Connections (social accounts through this app's Connect buttons; a mailbox, which is how invitations and digests leave — the host blocks direct mail) → Publish → Website (WordPress, or plan to use Download HTML) → Brand → Tone & motifs and Organization (voice, topics, guardrails, brand kit, and the AI brand context: differentiators, products, documents) → Settings → Schedule (timezone and posting slots) → Settings → People (invite the team; require approval if there is one) → Settings → Automation (start with assisted modes and low weekly targets; raise them once review is easy; or turn full autonomy on) → Admin → Analytics (Search Console site and GA4 property; a dash on Measure means not measured). Then take Elsie's short tour (the compass button).`,
  },
  {
    id: "troubleshooting",
    title: "When something looks wrong",
    keywords: ["wrong", "broken", "not working", "mock", "generic", "fake", "stuck", "nothing happens", "dash", "error", "reload", "why"],
    body: `Generic or "mock" output → no working AI key for this workspace; paste one under Admin → API keys and match the model. Nothing being drafted → the Approved pool is empty, the weekly target or daily budget is reached, drafting is on manual, or global pause is on. An article held with nothing to act on → the Inbox card names the failing check; a [NEEDS SOURCE] claim needs a live-search key to be sourced; wait one sweep, then verify or remove the sentence. An article at final approval that never publishes → not the publish day yet, or no WordPress (use Download HTML and Mark as published), or publishing not on auto. Social posts never send → no slots or timezone, a post awaiting approval, approved but never queued, or a broken account. Measure shows dashes → analytics not connected, or the Search Console property is missing the service account (a live probe under Admin → Analytics says which). A button does nothing after an update → reload the tab. The autopilot seems idle → idle sweeps are silent; other system activity (analytics and performance syncs) shows the scheduler is alive, and Run cycle now proves it. Images keep failing review → the reviewer found a real defect; approve a render or upload one, and check the brand kit's image specs.`,
  },
  {
    id: "assistant",
    title: "What the assistant can do (nearly everything you can)",
    keywords: ["assistant", "you", "can you", "ask", "tool", "help me", "dock", "confirm", "yes"],
    body: `I can do nearly everything a person can do in the app, from any page: the Ask button top-right (or Ctrl+/) opens me as a dock over whatever you are looking at; /assistant is the same conversation with more room. I read everything (pipeline, Inbox, ideas, articles and their checks, social posts, keywords, topics, channels, outliers, connections, dials, results, reports, best times, the live web, this guide) and I act: add, approve and reject ideas, discover ideas and keywords, add topics, draft articles and scripts, write SEO and images, run Optimize and apply / answer / dismiss findings, set article fields, verify or drop claims, approve images, advance an article, draft social posts, queue / schedule / send / unschedule them, publish an article or record it as published, export its HTML, set the publish day, slots, timezone, weekly target, modes, full autonomy, pause, the social dials, the video studio, invite people and change roles, run the autopilot now. I am also the research conversation: I know the active channel's niche, audience, voice and memory, read Intel channels and videos, YouTube transcripts, web pages and uploaded files, and turn a conversation into a script on the canvas.
How I behave: when a request is ambiguous I ask, with choices you can tap. When you are lost, say "what should I do next?" — I read the whole situation and rank the moves. Anything outward-facing or hard to undo (publishing, sending, queueing, approving, an override, a setting, an invitation) I PROPOSE first — "I'm about to: … Go ahead?" — and run only when you say yes; the proposal waits on the thread until you answer. Admin-only acts refuse for an editor, exactly as the page would. Every action I take is written to the audit log with its arguments, and each reply shows the steps I ran. I still cannot enter or change API keys or connection credentials, delete a workspace or an account, or send email — those stay a person's hands on the page.`,
  },
];

/** Find the best topic for a free-text query — keywords first, then title words. */
export function appGuide(query: string): GuideTopic | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const byId = APP_GUIDE.find((t) => t.id === q);
  if (byId) return byId;
  let best: GuideTopic | null = null;
  let bestScore = 0;
  for (const t of APP_GUIDE) {
    let score = 0;
    for (const k of t.keywords) if (q.includes(k)) score += k.length > 5 ? 3 : 2;
    for (const w of t.title.toLowerCase().split(/\W+/)) if (w.length > 3 && q.includes(w)) score += 1;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}
