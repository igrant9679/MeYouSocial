/**
 * Elsie — the in-app guide.
 *
 * Named for LSI Media: "L-S-I" said aloud is *el-ess-eye*. She walks a new
 * operator through setting the app up and then through actually using it.
 *
 * ── The one design decision that matters ────────────────────────────────────
 * Elsie is CONTEXTUAL, not a fixed slideshow. Setup steps are filtered against
 * what the workspace has actually done, so nobody is walked through connecting
 * an account they connected last week. A tour that tells you to do things you
 * have already done trains you to close it — and then it can't help with the
 * things you haven't.
 *
 * This file is pure data + one selector, deliberately: the sequencing is the
 * part worth testing, and it shouldn't need a browser to do it.
 */

/** What the workspace has already got done. Computed server-side, cheaply. */
export type SetupState = {
  hasLlmKey: boolean;
  socialConfigured: boolean;
  socialAccounts: number;
  emailConnected: boolean;
  topics: number;
  postingSlots: number;
  blogPosts: number;
  /** Platform operator — some setup is only theirs to do. */
  isOperator: boolean;
};

export type GuideStep = {
  id: string;
  title: string;
  body: string;
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

export const STEPS: GuideStep[] = [
  {
    id: "welcome",
    kind: "tour",
    title: `Hello, I'm ${ELSIE_NAME}`,
    body:
      "Your guide to MeYouSocial, from LSI Media. I'll show you what still needs setting up, then how the pieces fit together. " +
      "Two minutes, and you can stop any time — I'm the button in the top bar whenever you want me back.",
  },

  // ── Setup: only what's still outstanding ─────────────────────────────────
  {
    id: "setup-ai",
    kind: "setup",
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
    id: "setup-social",
    kind: "setup",
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
    id: "setup-brand",
    kind: "setup",
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
    needed: (s) => s.postingSlots === 0,
    title: "Set a posting schedule",
    body:
      "Define the times you publish — say 09:00 Monday to Friday — and you can drop any draft into the next free slot " +
      "instead of picking a date every time. Set the timezone here too; it's what the whole schedule is anchored to.",
    anchor: "posting-schedule",
    route: "/social",
    cta: { label: "Open Social", href: "/social" },
  },

  // ── The tour ─────────────────────────────────────────────────────────────
  {
    id: "tour-nav",
    kind: "tour",
    title: "Everything lives here",
    body:
      "The rail is the whole app, roughly in the order work flows: research and ideas at the top, writing in the middle, " +
      "publishing and measurement below.",
    anchor: "rail",
  },
  {
    id: "tour-ideas",
    kind: "tour",
    title: "Start with ideas",
    body:
      "Discovery proposes topics worth writing about, scored and tied to your Topics. Approve the good ones and they " +
      "become drafts without retyping anything.",
    anchor: "nav/ideas",
    cta: { label: "Open Ideas", href: "/ideas" },
  },
  {
    id: "tour-blog",
    kind: "tour",
    title: "Write and publish",
    body:
      "The blog module takes an idea to a finished post — outline, draft, SEO and accessibility checks, then publish. Its " +
      "Distribute tab spins the finished piece into social variants.",
    anchor: "nav/blog",
    cta: { label: "Open Blog", href: "/blog" },
  },
  {
    id: "tour-composer",
    kind: "tour",
    title: "Compose once, post everywhere",
    body:
      "Write the post once, pick the accounts, and customise per network only where you want to — each one shows its own " +
      "character count against its own limit.",
    anchor: "social-composer",
    route: "/social",
  },
  {
    id: "tour-calendar",
    kind: "tour",
    title: "See the whole month",
    body:
      "Month view shows coverage at a glance; Week is a time grid when you need to see exactly when things go out. Drag to " +
      "reschedule, or use the date box on any card — dragging is never the only way.",
    anchor: "social-calendar",
    route: "/social",
  },
  {
    id: "tour-insights",
    kind: "tour",
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
    title: "That's the tour",
    body:
      "Help has the long-form answers whenever you want them, and I'm in the top bar if you'd like this again. Switch me " +
      "off there too — I won't nag.",
    anchor: "nav/help",
  },
];

/**
 * The steps worth showing right now: outstanding setup first (in definition
 * order), then the tour. `done` ids drop out entirely.
 *
 * Setup before tour on purpose — being shown the social composer is noise if
 * you have no account connected to post from.
 */
export function relevantSteps(state: SetupState, done: string[] = []): GuideStep[] {
  const seen = new Set(done);
  return STEPS.filter((step) => {
    if (seen.has(step.id)) return false;
    if (step.kind === "setup") return step.needed ? step.needed(state) : true;
    return true;
  });
}

/** How much setup is still outstanding — drives the badge on the button. */
export function outstandingSetup(state: SetupState, done: string[] = []): number {
  return relevantSteps(state, done).filter((s) => s.kind === "setup").length;
}
