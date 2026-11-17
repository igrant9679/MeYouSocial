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
  /**
   * The group this page sits under on the strip's first row (2026-11-17, the
   * owner's "Yes, regroup tabs"). Pages of one group must be listed together.
   * The page keeps its own name and URL — "Settings → Keys" is still Keys, it
   * just sits under "AI & keys" — so nothing that links or refers to a page by
   * name changed. Fold a tab list with stageEntries(); never render `group`
   * by hand.
   */
  group?: string;
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
    // Queue / Sent / Drafts joined 2026-10-17 (Socialmonials parity): the
    // same posts as the Calendar, as searchable lists with filters.
    //
    // Grouped 2026-11-17: ten tabs in one row became five entries. Writing a
    // post (Compose, Captions), the lists of posts (the same PostList under
    // four filters), and what posts are made from (Media, RSS) each sit under
    // one name; Calendar and Engage stand alone. ⚠ "Post drafts", not "Drafts":
    // Drafts is the name of a whole stage on the rail.
    tabs: () => [
      { href: "/social/compose", label: "Compose", group: "Compose" },
      // Caption Studio (2026-10-17): the team's caption scenarios, run here.
      { href: "/social/captions", label: "Captions", group: "Compose" },
      { href: "/social/queue", label: "Queue", group: "Posts" },
      { href: "/social/sent", label: "Sent", group: "Posts" },
      { href: "/social/drafts", label: "Post drafts", group: "Posts" },
      // The posts set to recycle, with their controls (E-SOC-15).
      { href: "/social/evergreen", label: "Evergreen", group: "Posts" },
      { href: "/social/calendar", label: "Calendar" },
      { href: "/social/engage", label: "Engage" },
      { href: "/social/media", label: "Media", group: "Media & feeds" },
      { href: "/social/rss", label: "RSS", group: "Media & feeds" },
    ],
  },
  "/measure": {
    href: "/measure",
    label: "Measure",
    //
    // Grouped 2026-11-17, in the order a reader narrows down: every format at
    // once (the stage's own page with Reports and Insights — the one group
    // that holds the stage's Overview, see stageEntries), then each format,
    // then by Topic. ⚠ "By Topic", not "Topics": Topics is the Ideas tab where
    // Topics are kept; this one is what each of them earned.
    tabs: () => [
      { href: "/measure", label: "Summary", group: "Overview" },
      { href: "/reports", label: "Reports", group: "Overview" },
      { href: "/insights", label: "Insights", group: "Overview" },
      { href: "/blog/analytics", label: "Blog analytics", group: "Articles" },
      { href: "/blog/report", label: "Blog report", group: "Articles" },
      { href: "/social/performance", label: "Social performance" },
      { href: "/youtube", label: "YouTube audit" },
      // What each Topic earned, per format — the spine's far end (2026-09-21).
      { href: "/measure/topics", label: "By Topic" },
    ],
  },
  "/brand": {
    href: "/brand",
    label: "Brand",
    tabs: () => [
      { href: "/blog/brand", label: "Tone & motifs" },
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
    // People is admin-only too (setup/people is requireRole("ADMIN")) — it was
    // the one tab here that bounced editors and viewers (SHL-07).
    //
    // Grouped 2026-11-17: an admin's thirteen tabs (an operator's sixteen)
    // became five groups, by the question each page answers — who (People &
    // access), what goes out and where (Publishing), what the AI runs on and
    // costs (AI & keys), this workspace's own plumbing (Workspace), and the
    // platform's (Operator). An editor or viewer is left with Roles and
    // Publishing; a group with one page left is shown as that page.
    tabs: ({ admin, operator }) => [
      ...(admin ? [{ href: "/setup/people", label: "People", group: "People & access" }] : []),
      // What each role can do (E-SEC-17) — for everyone.
      { href: "/setup/roles", label: "Roles", group: "People & access" },
      ...(admin
        ? [
            { href: "/admin/api-tokens", label: "API tokens", group: "People & access" },
            { href: "/admin/audit-log", label: "Audit log", group: "People & access" },
          ]
        : []),
      { href: "/setup/automation", label: "Automation", group: "Publishing" },
      { href: "/setup/schedule", label: "Schedule", group: "Publishing" },
      { href: "/setup/connections", label: "Connections", also: ["/admin/connections"], group: "Publishing" },
      ...(admin
        ? [
            { href: "/admin/api-keys", label: "Keys", group: "AI & keys" },
            { href: "/admin/usage", label: "Usage", also: ["/admin/limits"], group: "AI & keys" },
            { href: "/admin/settings", label: "Workspace", group: "Workspace" },
            { href: "/admin/email", label: "Email", group: "Workspace" },
            { href: "/admin/analytics", label: "Analytics", group: "Workspace" },
            // The background queue: retry, cancel, what gave up (E-ENG-17).
            { href: "/admin/jobs", label: "Jobs", group: "Workspace" },
          ]
        : []),
      // The operator's pages; the unclaimed-accounts queue (E-SEC-15) rides Workspaces.
      ...(operator
        ? [
            { href: "/admin/workspaces", label: "Workspaces", also: ["/admin/unclaimed"], group: "Operator" },
            { href: "/admin/incident", label: "Incident", group: "Operator" },
            { href: "/admin/keyring", label: "Keyring", group: "Operator" },
          ]
        : []),
    ],
  },
};

/**
 * One entry of the strip's first row: a group under its own name, or a page
 * that stands alone.
 */
export type StageEntry = {
  /** Stable: the group's name, or the page's href when it stands alone. */
  key: string;
  label: string;
  /** Where a click goes — the first page under it that this person can open. */
  href: string;
  /** The pages under it; exactly one when it stands alone. */
  tabs: StageTab[];
  /** True when it shows as a group: two pages or more under one name. */
  group: boolean;
  /** True when it holds the stage's own page — it is then the strip's Overview. */
  home: boolean;
};

/**
 * Folds a stage's tabs into the strip's first row. Pass the tabs ALREADY
 * filtered to what the person can open: a group left with one page is shown
 * as that page (an editor's "People & access" is just Roles), and a group's
 * link goes to its first page that is left.
 *
 * ⚠ At most one group may hold the stage's own page (Measure's "Overview").
 * It replaces the strip's plain Overview link, keeps the name Overview even
 * when one page is left in it, and its link is the stage's own page.
 */
export function stageEntries(tabs: StageTab[], stageHref: string): StageEntry[] {
  const out: StageEntry[] = [];
  const byGroup = new Map<string, StageEntry>();
  for (const t of tabs) {
    const g = t.group ? byGroup.get(t.group) : undefined;
    if (g) { g.tabs.push(t); continue; }
    const e: StageEntry = { key: t.group ?? t.href, label: t.group ?? t.label, href: t.href, tabs: [t], group: !!t.group, home: false };
    out.push(e);
    if (t.group) byGroup.set(t.group, e);
  }
  for (const e of out) {
    e.home = e.tabs.some((t) => t.href === stageHref);
    if (e.home) { e.href = stageHref; e.label = "Overview"; }
    if (e.tabs.length === 1) { e.group = false; if (!e.home) e.label = e.tabs[0].label; }
  }
  return out;
}

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
