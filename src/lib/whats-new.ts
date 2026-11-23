/**
 * What changed that people can see (2026-11-22, the owner's "Yes, build it" to a
 * "What's new" note).
 *
 * ONE list, read by three places so they can never disagree:
 *   - the Inbox's "What's new" card (components/WhatsNew.tsx): the entries of the last
 *     SHOW_DAYS days that this person hasn't dismissed, that their role can open, and
 *     that happened after they joined the workspace — a newcomer is never told about
 *     a rename of something they never saw;
 *   - the Help's "What's new" category (lib/help.ts), every entry, links checked at
 *     build by scripts/check-routes.mts like every Help link;
 *   - Elsie's "What changed recently" topic (lib/assistant/knowledge.ts), so "what's
 *     new?" gets this list, not a guess.
 *
 * ⚠ A change people will notice adds its entry here IN THE SAME COMMIT — newest first,
 * `date` the day it went live, `id` never reused. The text is checked by
 * scripts/check-retired-names.mts like all copy. Plain data: no server imports, the
 * Help ships it to the browser.
 */

export type WhatsNewEntry = {
  /** Stable and unique; what a dismissal stores ("new:<id>"). */
  id: string;
  /** YYYY-MM-DD, the day it went live. */
  date: string;
  title: string;
  /** One or two plain sentences: what is different and where. */
  body: string;
  /** Where to see it, if there is one place. */
  href?: string;
  cta?: string;
  /** Only an admin can use it. */
  admin?: true;
};

/** How long an entry stays on the Inbox card. The Help keeps every entry. */
export const SHOW_DAYS = 30;

/** Most entries the Inbox card lists at once; the rest are in the Help. */
export const CARD_MAX = 5;

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "2026-11-23-post-images",
    date: "2026-11-23",
    title: "Post images: pick a style, add your branding",
    body: "Post pictures can be Editorial, Real people, Illustration, 3D render, Bold graphic or a Mix, and can wear a branded frame with a headline, your logo, @handle and website. Set both under Brand → Post images; Compose can change the style for one image.",
    href: "/brand#post-images",
    cta: "Open Brand",
  },
  {
    id: "2026-11-23-still-sending",
    date: "2026-11-23",
    title: "A post a network is still working on is no longer called failed",
    body: "When a network hasn't finished with a post (Instagram can take a few minutes with a picture), that network now shows as sending and the post waits under Publishing now until the result is in. It used to be marked failed and offered for Retry, which could have posted it twice. Older posts caught by this are checked again and corrected.",
    href: "/social/sent",
    cta: "Open Sent",
  },
  {
    id: "2026-11-23-add-live-link",
    date: "2026-11-23",
    title: "Add the live link to a published article",
    body: "A published article with no web address in Publisher now has Add live link, on the Articles overview and on the article's Distribute tab. Once it's saved, Add link in Compose offers the article and analytics matches its page.",
    href: "/publish",
    cta: "Open Articles",
    admin: true,
  },
  {
    id: "2026-11-22-copy-branding",
    date: "2026-11-22",
    title: "Copy branding from another of your workspaces",
    body: "An admin of two workspaces can give one the other's accent color and logo in one step, as a one-time copy. Keys can already be shared under Settings → Keys; social accounts, website, mailbox and storage never are.",
    href: "/admin/settings",
    cta: "Open Settings → Workspace",
    admin: true,
  },
  {
    id: "2026-11-22-readable-colours",
    date: "2026-11-22",
    title: "Coloured text is easier to read",
    body: "Coloured labels, chips and links were darkened just enough to meet the accessibility standard for small text in light mode, and in dark mode they are now lifted instead of staying dim. A check keeps every colour readable from here on.",
  },
  {
    id: "2026-11-22-engine-hashtags",
    date: "2026-11-22",
    title: "Hashtags on the posts the app writes",
    body: "Posts the app writes by itself now end with hashtags picked the way Compose suggests them: your saved hashtags first, then the Topic's, as many as the networks read well. A post's own page has Preview as posted too.",
    href: "/social/sent",
    cta: "Open Sent",
  },
  {
    id: "2026-11-21-post-preview",
    date: "2026-11-21",
    title: "See a post the way it will look",
    body: "Compose shows each post as it will appear on each network (Preview as posted), suggests hashtags from your brand and the post's Topic, and has Add link for any address or one of your published articles.",
    href: "/social/compose",
    cta: "Open Compose",
  },
  {
    id: "2026-11-19-stages-by-format",
    date: "2026-11-19",
    title: "The stages are named by format",
    body: "The rail reads Articles, Social posts and Video, so each stage says what it is for. The old names Drafts, Publish and Distribute are gone, and every old link still works. Measure's article tabs are Article analytics and Article report.",
    href: "/publish",
    cta: "Open Articles",
  },
  {
    id: "2026-11-19-other-workspace",
    date: "2026-11-19",
    title: "Links into your other workspaces",
    body: "Opening something that belongs to another of your workspaces offers to switch you there, instead of a page saying it can't be found.",
  },
  {
    id: "2026-11-18-one-calendar",
    date: "2026-11-18",
    title: "Posts and articles on one calendar",
    body: "Social posts → Calendar shows posts and articles together, with Show: All, Posts or Articles. An article is marked at the moment it goes out.",
    href: "/social/calendar",
    cta: "Open the calendar",
  },
  {
    id: "2026-11-18-approvals",
    date: "2026-11-18",
    title: "Approvals is a Social posts tab",
    body: "Approving posts sits beside the queue and the calendar, so everything about a social post is in one stage.",
    href: "/social/approvals",
    cta: "Open Approvals",
  },
  {
    id: "2026-11-17-tab-groups",
    date: "2026-11-17",
    title: "Long tab rows are grouped",
    body: "Settings, Social posts and Measure show a first row of groups and a second row with the pages of the group you are in. Every page kept its name and address.",
    href: "/measure",
    cta: "See Measure",
  },
  {
    id: "2026-11-17-model-tiers",
    date: "2026-11-17",
    title: "Pick a model by the kind of job",
    body: "Model tiers let light jobs use a cheaper model and demanding ones your best, while a person's own choice always wins. Off until an admin turns it on.",
    href: "/admin/settings",
    cta: "Open Settings → Workspace",
    admin: true,
  },
  {
    id: "2026-11-17-customer-brief",
    date: "2026-11-17",
    title: "What Elsie knows about your customers",
    body: "Brand shows the customer brief Elsie works from, each line marked as described by a person, an AI draft, or measured.",
    href: "/brand#customers",
    cta: "Open Brand",
  },
  {
    id: "2026-11-16-elsie-pane",
    date: "2026-11-16",
    title: "Elsie can sit beside the page",
    body: "Her pane can stay at the side of any page, and it lists suggestions drawn from your own data. Open it with the Elsie button in the header or Ctrl+/.",
  },
  {
    id: "2026-11-15-key-sharing",
    date: "2026-11-15",
    title: "Share a key between two workspaces",
    body: "An admin of both workspaces can let one use the other's key, without copying it.",
    href: "/admin/api-keys",
    cta: "Open Settings → Keys",
    admin: true,
  },
  {
    id: "2026-11-11-ideas-drawn-from",
    date: "2026-11-11",
    title: "Ideas say what they were drawn from",
    body: "Article, social and video ideas are grounded in what people are discussing right now, and each idea lists the discussions it was drawn from.",
    href: "/ideas",
    cta: "Open Ideas",
  },
];

/**
 * "21 Nov 2026", the app's date style: the same options as `formatDay` in
 * lib/zoned-dates.ts, written out here because that module imports the database
 * (through lib/social/slots) and this list ships to the browser with the Help.
 */
export const whatsNewDay = (e: Pick<WhatsNewEntry, "date">): string =>
  new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The key a dismissal stores. */
export const whatsNewKey = (id: string): string => `new:${id}`;

/**
 * The entries one person's Inbox card shows: newer than SHOW_DAYS, dated AFTER the day
 * they joined this workspace, admin-only ones for admins, links their role can open,
 * and not dismissed. Newest first, as the list is.
 */
export function whatsNewFor(opts: {
  now: Date;
  joinedAt: Date;
  admin: boolean;
  canOpen: (href: string) => boolean;
  dismissed: ReadonlySet<string>;
}): WhatsNewEntry[] {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const oldest = day(new Date(opts.now.getTime() - SHOW_DAYS * 86_400_000));
  const joined = day(opts.joinedAt);
  return WHATS_NEW.filter(
    (e) =>
      e.date >= oldest &&
      e.date > joined &&
      (!e.admin || opts.admin) &&
      (!e.href || opts.canOpen(e.href)) &&
      !opts.dismissed.has(whatsNewKey(e.id)),
  );
}
