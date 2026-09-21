/**
 * The stages (One-Loop redesign) and which page belongs to which. Shared by
 * the rail (which stage to light), the persistent stage strip (which tabs to
 * show and which is current) and the stage pages themselves. Plain data and
 * regexes — safe to import from client components.
 *
 * `/brand` and `/setup` are not loop stages but get a strip the same way:
 * Brand because the tone-and-motifs and organisation pages under /blog/ used
 * to strand people on a Blog tab bar, Settings because its four questions
 * (One-Loop step 5) are tabs of one page.
 */

export type StageTab = {
  href: string;
  label: string;
  /** Extra path prefixes that also count as this tab (e.g. a script editor). */
  also?: string[];
};

export type StageCtx = {
  channelId: string | null;
  studio: boolean;
  /** Settings shows the operator pages as tabs only to a workspace ADMIN. */
  admin: boolean;
  /** Creating/switching workspaces is the platform operator's, not an admin's. */
  operator: boolean;
};

export type StageDef = {
  href: string;
  label: string;
  /** Tabs may depend on the active channel (null when the workspace has none) and on whether the video studio is shown. */
  tabs: (ctx: StageCtx) => StageTab[];
};

// ⚠ "/review" left this list on 2026-09-20 (audit B1.1): its overview was the
// Inbox, card for card, and its two real tabs belong to Publish. /review still
// resolves — it redirects to /inbox.
export const STAGE_HREFS = ["/research", "/ideas", "/drafts", "/publish", "/distribute", "/measure", "/brand", "/setup"] as const;

export const STAGES: Record<(typeof STAGE_HREFS)[number], StageDef> = {
  "/research": {
    href: "/research",
    label: "Research",
    tabs: ({ channelId }) => [
      { href: "/intel", label: "Intel" },
      { href: "/intel/bookmarks", label: "Bookmarks" },
      ...(channelId ? [{ href: `/channels/${channelId}/competitors`, label: "Competitors", also: ["/channels/*/competitors", "/channels/*/research"] }] : []),
      // The Chat tab retired 2026-09-09 — the assistant (Ask, on every page) is the research conversation now.
    ],
  },
  "/ideas": {
    href: "/ideas",
    label: "Ideas",
    // Topics moved here from Brand on 2026-09-21 ("Topics as the spine"): a
    // tab, not a rail entry, four days after the audit took the rail from
    // fourteen entries to twelve. The per-Topic page is under it.
    tabs: () => [
      { href: "/ideas/topics", label: "Topics" },
      { href: "/blog/keywords", label: "Keywords" },
      { href: "/blog/experts", label: "Experts" },
    ],
  },
  "/drafts": {
    href: "/drafts",
    label: "Drafts",
    // The studio tabs show only when a YouTube channel exists and the Video
    // studio switch under Settings is on (lib/studio.ts) — the owner's
    // "optional as a studio". Articles and the board are always there.
    tabs: ({ channelId, studio }) => [
      // One tab, not two: /blog and /blog/board were the same four columns
      // under two names (audit B1.2). The board/list toggle lives on the page.
      { href: "/blog", label: "Articles", also: ["/blog/board"] },
      ...(studio
        ? [
            { href: channelId ? `/channels/${channelId}/scripts` : "/scripts", label: "Scripts", also: ["/scripts", "/channels/*/scripts"] },
            { href: "/thumbnails", label: "Thumbnails" },
            { href: "/videos", label: "Videos" },
            { href: "/production", label: "Production" },
          ]
        : []),
    ],
  },
  "/publish": {
    href: "/publish",
    label: "Publish",
    // Approvals and Audit came here from the retired Review stage: both gate
    // what goes out, which is this stage's whole job.
    tabs: () => [
      { href: "/social/approvals", label: "Approvals" },
      { href: "/blog/audit", label: "Audit" },
      { href: "/website", label: "Website" },
      { href: "/blog/calendar", label: "Blog calendar" },
    ],
  },
  "/distribute": {
    href: "/distribute",
    label: "Distribute",
    tabs: () => [
      { href: "/social/compose", label: "Compose" },
      { href: "/social/calendar", label: "Calendar" },
      { href: "/social/engage", label: "Engage" },
    ],
  },
  "/measure": {
    href: "/measure",
    label: "Measure",
    tabs: () => [
      { href: "/reports", label: "Reports" },
      { href: "/insights", label: "Insights" },
      { href: "/blog/analytics", label: "Blog analytics" },
      { href: "/blog/report", label: "Blog report" },
      { href: "/social/performance", label: "Social performance" },
      { href: "/youtube", label: "YouTube audit" },
    ],
  },
  "/brand": {
    href: "/brand",
    label: "Brand",
    tabs: () => [
      { href: "/blog/brand", label: "Tone & motifs" },
      { href: "/blog/organization", label: "Organization" },
    ],
  },
  "/setup": {
    href: "/setup",
    label: "Settings",
    // ⚠ There used to be TWO settings surfaces with two rail entries and two
    // tab strips: Settings (4 tabs) and "Publish Admin" (10), with People
    // duplicated between them and "Connections" naming a different page in
    // each (audit B1.3/B1.4). The admin pages keep their /admin/* URLs — some
    // thirty actions redirect to them — only the NAVIGATION moved here.
    //
    // ⚠ `admin` is the ONLY thing stopping an EDITOR or VIEWER being shown
    // five tabs that all bounce to /forbidden: /setup itself is
    // requireMembership, not requireRole.
    //
    // Deliberately NOT a tab: /admin/connections (the Zernio/Unipile connect
    // machinery) — /setup/connections is the read-only "what's missing" list
    // and every row links to the page that fixes it, so it stays one entry
    // rather than two called the same thing. `also` keeps it lit there.
    // /admin/limits rides Usage, and /admin/channels has the Channels rail
    // entry of its own.
    tabs: ({ admin, operator }) => [
      { href: "/setup/people", label: "People" },
      { href: "/setup/automation", label: "Automation" },
      { href: "/setup/schedule", label: "Schedule" },
      { href: "/setup/connections", label: "Connections", also: ["/admin/connections"] },
      ...(admin
        ? [
            { href: "/admin/api-keys", label: "Keys" },
            { href: "/admin/analytics", label: "Analytics" },
            { href: "/admin/email", label: "Email" },
            { href: "/admin/settings", label: "Workspace" },
            { href: "/admin/usage", label: "Usage", also: ["/admin/limits"] },
          ]
        : []),
      ...(operator ? [{ href: "/admin/workspaces", label: "Workspaces" }] : []),
    ],
  },
};

/** Which stage a page belongs to — the stage's own href included. */
export function stageFor(pathname: string): (typeof STAGE_HREFS)[number] | null {
  const p = pathname;
  for (const h of STAGE_HREFS) if (p === h || p.startsWith(h + "/")) return h;
  // Every operator page is a Settings tab now (audit B1.4). Placed before the
  // other clauses for clarity; /admin is not a STAGE_HREF, so no collision.
  if (/^\/admin(\/|$)/.test(p)) return "/setup";
  if (/^\/blog\/(brand|organization)(\/|$)/.test(p)) return "/brand";
  if (/^\/(intel|chat)(\/|$)/.test(p) || /^\/channels\/[^/]+\/(competitors|research)(\/|$)/.test(p)) return "/research";
  if (/^\/blog\/(keywords|experts)(\/|$)/.test(p) || /^\/channels\/[^/]+\/ideas(\/|$)/.test(p)) return "/ideas";
  if (/^\/social\/approvals(\/|$)/.test(p) || /^\/blog\/audit(\/|$)/.test(p)) return "/publish";
  if (/^\/website(\/|$)/.test(p) || /^\/blog\/(calendar|automation)(\/|$)/.test(p)) return "/publish";
  if (/^\/(reports|insights|youtube)(\/|$)/.test(p) || /^\/blog\/(analytics|report)(\/|$)/.test(p) || /^\/social\/performance(\/|$)/.test(p)) return "/measure";
  if (/^\/social(\/|$)/.test(p)) return "/distribute";
  if (/^\/(scripts|thumbnails|videos|production)(\/|$)/.test(p) || /^\/channels\/[^/]+\/scripts(\/|$)/.test(p) || /^\/blog(\/|$)/.test(p)) return "/drafts";
  return null;
}

function prefixMatches(pathname: string, prefix: string): number {
  // "*" in a prefix stands for one path segment (a channel id).
  const re = new RegExp("^" + prefix.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+") + "(/|$)");
  return re.test(pathname) ? prefix.length : 0;
}

/** The current tab: the longest matching prefix wins, so /blog/board beats /blog. */
export function currentTab(pathname: string, tabs: StageTab[]): StageTab | null {
  let best: StageTab | null = null;
  let bestLen = 0;
  for (const t of tabs) {
    const candidates = [t.href.split("?")[0], ...(t.also ?? [])];
    for (const c of candidates) {
      const n = prefixMatches(pathname, c);
      if (n > bestLen) { best = t; bestLen = n; }
    }
  }
  return best;
}
