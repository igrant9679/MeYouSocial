/**
 * Elsie — the in-app guide.
 *
 * Named for LSI Media: "L-S-I" said aloud is *el-ess-eye*. She walks a new
 * operator through setting the app up and then through actually using it.
 *
 * ── The two design decisions that matter ────────────────────────────────────
 * 1. Elsie is CONTEXTUAL, not a fixed slideshow. Setup steps are filtered
 *    against what the workspace has actually done, so nobody is walked through
 *    connecting an account they connected last week. A tour that tells you to
 *    do things you have already done trains you to close it — and then it can't
 *    help with the things you haven't.
 * 2. Tours are SHORT AND CHOSEN. One 20-step march through every module is the
 *    same mistake in a different shape. Steps belong to a `track`; the welcome
 *    card offers the tracks and you take the one you need. Setup always comes
 *    first because being shown the composer is noise if nothing can post.
 *
 * This file is pure data + selectors, deliberately: the sequencing is the part
 * worth testing, and it shouldn't need a browser to do it.
 *
 * ⚠ ANCHORS ARE `data-elsie` ATTRIBUTES, NEVER CSS SELECTORS. A positional
 * selector breaks silently when a toolbar is reordered and then points
 * confidently at the wrong thing. `LeftRailNav` emits `nav/<href>` for every
 * rail entry, so any nav target is anchorable with no extra markup.
 */

/** What the workspace has already got done. Computed server-side, cheaply. */
export type SetupState = {
  hasLlmKey: boolean;
  /**
   * A model is actually selected for this workspace. Distinct from `hasLlmKey`
   * on purpose: a Google key with every channel left on `claude-sonnet` sends
   * work to a provider you may not have paid for, and the router falls back to
   * mock on failure — so it looks configured and quietly writes placeholder
   * text. That exact trap cost real time here; it earns its own step.
   */
  defaultModelSet: boolean;
  /** At least one channel is linked to a real YouTube channel. */
  channelLinked: boolean;
  socialConfigured: boolean;
  socialAccounts: number;
  emailConnected: boolean;
  /** Files survive a redeploy (Drive), rather than living on ephemeral disk. */
  storageDurable: boolean;
  /** Search Console / GA4 / YouTube OAuth — any one of them. */
  analyticsConnected: boolean;
  topics: number;
  postingSlots: number;
  blogPosts: number;
  /** Platform operator — some setup is only theirs to do. */
  isOperator: boolean;
};

/** Which tour a step belongs to. `setup` is never a chosen tour — it leads. */
export type GuideTrack = "setup" | "essentials" | "content" | "publishing" | "measure" | "admin";

export type GuideStep = {
  id: string;
  title: string;
  body: string;
  track: GuideTrack;
  /**
   * `data-elsie` value of the element to spotlight. Omit for a centred card
   * (welcome / sign-off), which needs no anchor.
   */
  anchor?: string;
  /** Where the anchor lives. Elsie navigates here first if you're elsewhere. */
  route?: string;
  /** Optional "take me there" link shown alongside Next. */
  cta?: { label: string; href: string };
  /** Setup steps are skipped once done; tour steps always show. */
  kind: "setup" | "tour";
  /** Setup steps only: true when this still needs doing. */
  needed?: (s: SetupState) => boolean;
};

export const ELSIE_NAME = "Elsie";

export type TrackMeta = {
  id: GuideTrack;
  label: string;
  blurb: string;
  /** Hidden from anyone who isn't the platform operator. */
  operatorOnly?: boolean;
};

/** Offered on the welcome card, in this order. `setup` is not listed — it runs first regardless. */
export const TRACKS: TrackMeta[] = [
  { id: "essentials", label: "The short tour", blurb: "How the app fits together, in about a minute." },
  { id: "content", label: "Making content", blurb: "Research, ideas, scripts, video and the production board." },
  { id: "publishing", label: "Publishing", blurb: "Composing, the calendar, queue slots and what happens after you send." },
  { id: "measure", label: "Measuring", blurb: "Insights, reports, and what the numbers are allowed to claim." },
  { id: "admin", label: "Running the install", blurb: "Keys, connections, storage, people and deleting things.", operatorOnly: true },
];

export const STEPS: GuideStep[] = [
  {
    id: "welcome",
    kind: "tour",
    track: "essentials",
    title: `Hello, I'm ${ELSIE_NAME}`,
    body:
      "Your guide to MeYouSocial, from LSI Media. I'll flag anything still worth setting up, then you can pick a tour — " +
      "each one is short. Stop any time; I'm the button in the top bar whenever you want me back.",
  },

  // ── Setup: only what's still outstanding ─────────────────────────────────
  {
    id: "setup-ai",
    kind: "setup",
    track: "setup",
    needed: (s) => s.isOperator && !s.hasLlmKey,
    title: "Add an AI provider key",
    body:
      "Everything that writes — ideas, drafts, social variants — runs through an AI provider. Without a key the app still " +
      "works, but it returns placeholder text rather than real content. Paste an Anthropic or Google key and the whole " +
      "engine comes alive.",
    anchor: "nav/admin",
    route: "/admin/api-keys",
    cta: { label: "Open API keys", href: "/admin/api-keys" },
  },
  {
    id: "setup-model",
    kind: "setup",
    track: "setup",
    // Only worth raising once a key exists — otherwise setup-ai covers it.
    needed: (s) => s.hasLlmKey && !s.defaultModelSet,
    title: "Point the app at the model you're paying for",
    body:
      "A key on its own isn't enough: each channel and workspace also chooses which model to use, and the default is " +
      "Claude. If you added a Google key but left the model on Claude, work goes to the wrong provider — and when that " +
      "call fails the app quietly falls back to placeholder text rather than erroring. Set the model to match your key.",
    anchor: "nav/brand",
    route: "/brand",
    cta: { label: "Choose a model", href: "/admin/api-keys" },
  },
  {
    id: "setup-channel",
    kind: "setup",
    track: "setup",
    needed: (s) => !s.channelLinked,
    title: "Link your YouTube channel",
    body:
      "Linking a channel is what lets the app read your real videos: it trains the voice profile from your own titles and " +
      "descriptions, builds the audience picture, and gives Intel something to compare against. Unlinked, those surfaces " +
      "can only offer generic starting points.",
    anchor: "nav/channels",
    route: "/channels",
    cta: { label: "Open Channels", href: "/channels" },
  },
  {
    id: "setup-social",
    kind: "setup",
    track: "setup",
    needed: (s) => s.isOperator && !s.socialConfigured,
    title: "Connect social publishing",
    body:
      "Posting runs through Zernio, which covers fifteen networks including LinkedIn, X, Facebook and Instagram. Add the " +
      "API key once for the whole install, then each workspace connects its own profiles underneath it.",
    anchor: "nav/admin",
    route: "/admin/connections",
    cta: { label: "Open Connections", href: "/admin/connections" },
  },
  {
    id: "setup-accounts",
    kind: "setup",
    track: "setup",
    needed: (s) => s.socialConfigured && s.socialAccounts === 0,
    title: "Connect your profiles",
    body:
      "Zernio is ready — now link the accounts you actually post from. Each one opens the network's own sign-in, so no " +
      "passwords are ever stored here.",
    anchor: "nav/admin",
    route: "/admin/connections",
    cta: { label: "Connect an account", href: "/admin/connections" },
  },
  {
    id: "setup-email",
    kind: "setup",
    track: "setup",
    needed: (s) => s.isOperator && !s.emailConnected,
    title: "Connect a mailbox",
    body:
      "Invitations, verification and password resets need somewhere to send from. This host blocks ordinary SMTP, so mail " +
      "goes out through a mailbox you connect over HTTPS. Until then those emails are only simulated.",
    anchor: "nav/admin",
    route: "/admin/connections",
    cta: { label: "Open Connections", href: "/admin/connections" },
  },
  {
    id: "setup-storage",
    kind: "setup",
    track: "setup",
    needed: (s) => s.isOperator && !s.storageDurable,
    title: "Make uploads survive a redeploy",
    body:
      "Files are on the server's local disk, which this host wipes every time the app redeploys — images, voiceovers and " +
      "rendered video all go with it. Connecting Google Drive keeps them. Switching runs a real write test first and only " +
      "commits if it passes.",
    anchor: "nav/admin",
    route: "/admin/api-keys",
    cta: { label: "Open Storage", href: "/admin/api-keys#storage" },
  },
  {
    id: "setup-brand",
    kind: "setup",
    track: "setup",
    needed: (s) => s.topics === 0,
    title: "Tell us what you publish about",
    body:
      "Topics are the themes this company writes about. They steer idea discovery, tag everything you make, and let the " +
      "Insights page compare what's working. Add two or three to start.",
    anchor: "nav/brand",
    route: "/brand",
    cta: { label: "Open Brand", href: "/brand" },
  },
  {
    id: "setup-slots",
    kind: "setup",
    track: "setup",
    needed: (s) => s.postingSlots === 0,
    title: "Set a posting schedule",
    body:
      "Define the times you publish — say 09:00 Monday to Friday — and you can drop any draft into the next free slot " +
      "instead of picking a date every time. Set the timezone here too; it's what the whole schedule is anchored to.",
    anchor: "posting-schedule",
    route: "/social",
    cta: { label: "Open Social", href: "/social" },
  },
  {
    id: "setup-analytics",
    kind: "setup",
    track: "setup",
    needed: (s) => !s.analyticsConnected,
    title: "Connect your analytics",
    body:
      "Search Console, GA4 and YouTube feed the performance half of Insights. Without them the app can measure its own " +
      "pipeline — what you made, how fast — but nothing about how any of it actually performed once published.",
    anchor: "nav/admin",
    route: "/admin/analytics",
    cta: { label: "Open Analytics", href: "/admin/analytics" },
  },

  // ── Track: the short tour ────────────────────────────────────────────────
  {
    id: "tour-nav",
    kind: "tour",
    track: "essentials",
    title: "Everything lives here",
    body:
      "The rail is the whole app, roughly in the order work flows: research and ideas at the top, writing in the middle, " +
      "publishing and measurement below.",
    anchor: "rail",
  },
  {
    id: "tour-ideas",
    kind: "tour",
    track: "essentials",
    title: "Start with ideas",
    body:
      "Discovery proposes topics worth writing about, scored against real competitor performance and tied to your Topics. " +
      "Approve the good ones and they become drafts without retyping anything.",
    anchor: "nav/ideas",
    cta: { label: "Open Ideas", href: "/ideas" },
  },
  {
    id: "tour-blog",
    kind: "tour",
    track: "essentials",
    title: "Write and publish",
    body:
      "The blog module takes an idea to a finished post — outline, draft, SEO and accessibility checks, then publish. Its " +
      "Distribute tab spins the finished piece into social variants.",
    anchor: "nav/blog",
    cta: { label: "Open Blog", href: "/blog" },
  },
  {
    id: "tour-social",
    kind: "tour",
    track: "essentials",
    title: "Get it out the door",
    body:
      "Social is composer, calendar and queue in one place: write once, choose the accounts, and either schedule it or drop " +
      "it into the next free slot.",
    anchor: "nav/social",
    cta: { label: "Open Social", href: "/social" },
  },
  {
    id: "tour-insights",
    kind: "tour",
    track: "essentials",
    title: "Find out what worked",
    body:
      "Insights measures the pipeline and pulls engagement back from the networks. Every figure says where it came from, " +
      "and a blank means we genuinely don't know — never a zero standing in for missing data.",
    anchor: "nav/insights",
    cta: { label: "Open Insights", href: "/insights" },
  },
  {
    id: "tour-help",
    kind: "tour",
    track: "essentials",
    title: "That's the tour",
    body:
      "Help has the long-form answers and the other tours whenever you want them, and I'm in the top bar if you'd like " +
      "this again. Switch me off there too — I won't nag.",
    anchor: "nav/help",
  },

  // ── Track: making content ────────────────────────────────────────────────
  {
    id: "content-brand",
    kind: "tour",
    track: "content",
    title: "Brand comes first",
    body:
      "Topics, tone motifs, personas and keywords live here, and everything downstream reads them. Changing your tone here " +
      "changes how every future draft sounds — it isn't a settings page you fill in once and forget.",
    anchor: "nav/brand",
    cta: { label: "Open Brand", href: "/brand" },
  },
  {
    id: "content-voice",
    kind: "tour",
    track: "content",
    title: "Voice is trained, not typed",
    body:
      "A channel's voice profile is built from its own video titles and descriptions. Each profile says what trained it and " +
      "across how many videos — and an untrained one says so plainly rather than passing a generic placeholder off as yours.",
    anchor: "nav/channels",
    cta: { label: "Open Channels", href: "/channels" },
  },
  {
    id: "content-intel",
    kind: "tour",
    track: "content",
    title: "Watch the competition",
    body:
      "Intel tracks the channels you compete with and scores their uploads against their own average — that ratio is what " +
      "an outlier score means. It's also where idea discovery gets its seeds.",
    anchor: "nav/intel",
    cta: { label: "Open Intel", href: "/intel" },
  },
  {
    id: "content-scripts",
    kind: "tour",
    track: "content",
    title: "From idea to script",
    body:
      "Scripts is the long-form writing surface: templates for recurring formats, a canvas for drafting, and the agent for " +
      "the first pass. The channel's voice profile and your motifs are injected into every generation.",
    anchor: "nav/scripts",
    cta: { label: "Open Scripts", href: "/scripts" },
  },
  {
    id: "content-video",
    kind: "tour",
    track: "content",
    title: "Storyboards and shorts",
    body:
      "Videos turns a post or script into a scene board, renders it, and stitches the scenes into one file. Branded shorts " +
      "are the quicker path — a title card themed from your BrandKit, no storyboard needed.",
    anchor: "nav/videos",
    cta: { label: "Open Videos", href: "/videos" },
  },
  {
    id: "content-production",
    kind: "tour",
    track: "content",
    title: "Track the work",
    body:
      "The production board runs the pipeline from idea to published, with tasks, assets and a wiki for the standing " +
      "answers. Drag cards between columns, or use the dropdown on each — dragging is never the only way.",
    anchor: "nav/production",
    cta: { label: "Open Production", href: "/production" },
  },

  // ── Track: publishing ────────────────────────────────────────────────────
  {
    id: "tour-composer",
    kind: "tour",
    track: "publishing",
    title: "Compose once, post everywhere",
    body:
      "Write the post once, pick the accounts, and customise per network only where you want to — each one shows its own " +
      "character count against its own limit, and can carry its own image.",
    anchor: "social-composer",
    route: "/social",
  },
  {
    id: "tour-calendar",
    kind: "tour",
    track: "publishing",
    title: "See the whole month",
    body:
      "Month view shows coverage at a glance; Week is a time grid when you need to see exactly when things go out. Drag to " +
      "reschedule, or use the date box on any card — dragging is never the only way.",
    anchor: "social-calendar",
    route: "/social",
  },
  {
    id: "publishing-slots",
    kind: "tour",
    track: "publishing",
    title: "Queue instead of picking dates",
    body:
      "Slots are your standing publishing times, held as wall-clock — 09:00 Tuesday stays 09:00 across daylight saving. " +
      "Queue a draft and it takes the next free one. If none are free the app says so rather than inventing a time.",
    anchor: "posting-schedule",
    route: "/social",
  },
  {
    id: "publishing-after",
    kind: "tour",
    track: "publishing",
    title: "After it's sent",
    body:
      "History shows the per-network result of every send, with retry on the ones that failed. Links are tagged per network " +
      "at send time, not when you write, so the same post can be told apart by source in your analytics.",
    anchor: "nav/social",
    cta: { label: "Open Social", href: "/social" },
  },

  // ── Track: measuring ─────────────────────────────────────────────────────
  {
    id: "measure-insights",
    kind: "tour",
    track: "measure",
    title: "What Insights actually measures",
    body:
      "Two halves: your own pipeline, which the app knows exactly, and performance pulled back from the networks, which it " +
      "knows only as well as the connections allow. Each figure carries its sample size and where it came from.",
    anchor: "nav/insights",
    cta: { label: "Open Insights", href: "/insights" },
  },
  {
    id: "measure-evidence",
    kind: "tour",
    track: "measure",
    title: "A blank is not a zero",
    body:
      "Where there's no data you'll see a dash and a reason, never a 0 — a fabricated zero looks like a measurement and " +
      "isn't. Recommendations follow the same rule: they stay silent below a usable sample rather than guessing.",
    anchor: "nav/insights",
    cta: { label: "Open Insights", href: "/insights" },
  },
  {
    id: "measure-reports",
    kind: "tour",
    track: "measure",
    title: "Reports for other people",
    body:
      "Reports package the same numbers for someone who doesn't use the app — a client or a board. Build your own from the " +
      "available blocks and export it.",
    anchor: "nav/reports",
    cta: { label: "Open Reports", href: "/reports" },
  },

  // ── Track: running the install (operator) ────────────────────────────────
  {
    id: "admin-keys",
    kind: "tour",
    track: "admin",
    title: "Keys live in the app",
    body:
      "Provider keys are set here, not in the host's environment, and each workspace can bring its own — a key you paste " +
      "for one company is never visible to another. Saving takes effect within about thirty seconds, no redeploy.",
    anchor: "nav/admin",
    route: "/admin/api-keys",
    cta: { label: "Open API keys", href: "/admin/api-keys" },
  },
  {
    id: "admin-storage",
    kind: "tour",
    track: "admin",
    title: "Where files actually go",
    body:
      "Local disk is wiped on every redeploy. Google Drive keeps files, and there are two ways to reach it: connect a " +
      "Google account, which works on a personal address, or a service account, which needs a Workspace Shared Drive. " +
      "The card explains which suits you.",
    anchor: "nav/admin",
    route: "/admin/api-keys",
    cta: { label: "Open Storage", href: "/admin/api-keys#storage" },
  },
  {
    id: "admin-people",
    kind: "tour",
    track: "admin",
    title: "People and roles",
    body:
      "Invite by email and pick a role: viewers read, editors make things, admins change settings. Revoke suspends someone " +
      "and keeps their history; Remove deletes the membership. The last admin can't be removed — that would lock everyone out.",
    anchor: "nav/admin",
    route: "/admin",
    cta: { label: "Open Users", href: "/admin" },
  },
  {
    id: "admin-delete",
    kind: "tour",
    track: "admin",
    title: "Deleting things",
    body:
      "Almost everything can be deleted from where it lives. Anything that takes other records with it — a channel, a " +
      "project, a workspace — asks you to type its name and lists exactly what else goes. Every deletion is recorded in " +
      "the audit log with the record's name, so it stays answerable afterwards.",
    anchor: "nav/admin",
    route: "/admin/channels",
    cta: { label: "Open Channels admin", href: "/admin/channels" },
  },
];

/** Setup steps still outstanding, in definition order. */
export function outstandingSteps(state: SetupState, done: string[] = []): GuideStep[] {
  const seen = new Set(done);
  return STEPS.filter((s) => s.kind === "setup" && !seen.has(s.id) && (s.needed ? s.needed(state) : true));
}

/** The steps of one tour, minus anything already dismissed. */
export function trackSteps(track: GuideTrack, done: string[] = []): GuideStep[] {
  const seen = new Set(done);
  return STEPS.filter((s) => s.track === track && s.kind === "tour" && !seen.has(s.id));
}

/**
 * The default run: outstanding setup first, then the short tour.
 *
 * Setup before tour on purpose — being shown the social composer is noise if
 * you have no account connected to post from. The other tracks are opt-in from
 * the welcome card; piling all of them into one sequence would be the
 * twenty-step march this design exists to avoid.
 */
export function relevantSteps(state: SetupState, done: string[] = []): GuideStep[] {
  // Welcome leads, even though it belongs to the essentials track: opening on
  // "Add an AI provider key" with no introduction is a demand, not a greeting.
  const essentials = trackSteps("essentials", done);
  const welcome = essentials.filter((s) => s.id === "welcome");
  const rest = essentials.filter((s) => s.id !== "welcome");
  return [...welcome, ...outstandingSteps(state, done), ...rest];
}

/** How much setup is still outstanding — drives the badge on the button. */
export function outstandingSetup(state: SetupState, done: string[] = []): number {
  return outstandingSteps(state, done).length;
}

/** Tracks offered on the welcome card, with their steps already resolved. */
export function availableTracks(state: SetupState, done: string[] = []) {
  return TRACKS.filter((t) => !t.operatorOnly || state.isOperator)
    .map((t) => ({ ...t, steps: trackSteps(t.id, done) }))
    .filter((t) => t.steps.length > 0);
}
