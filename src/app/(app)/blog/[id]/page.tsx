import Link from "next/link";
import { DiffRows } from "@/components/DiffView";
import { compareWithLive } from "@/lib/wp-update";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, MonitorSmartphone, ShieldCheck, Sparkles, Trash2, X, Send } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks } from "@/lib/blog-checks";
import { bodyHash, gatesSatisfied, overrideHolds } from "@/lib/blog-gates";
import { formatInZone, getPostingTimeZone, toZonedInput } from "@/lib/social/slots";
import { Banner } from "@/components/SocialPostCard";
import { contentScore } from "@/lib/blog-score";
import { BLOG_TEMPLATES } from "@/lib/blog-templates";
import {
  ensureMotifDirectives,
  getBrandKit,
  motifHue,
  motifSummaryLabel,
  parseMotifs,
  resolveMotifs,
} from "@/lib/motifs";
import {
  IMAGE_ROLES,
  ROLE_LABELS,
  dimensionVerdict,
  getImageBriefs,
  loadAssetGate,
  specFor,
} from "@/lib/blog-images";
import { applySlugConvention, parseSlugRules, slugMatchesConvention } from "@/lib/seo-plugins";
import { selectSmeProfile } from "@/lib/sme";
import { loadEditorialContext } from "@/lib/blog-slop";
import { renderForPublish } from "@/lib/blog-render";
import { PROFILE_LABELS, isRenderProfile, parseRenderRules, reportSummary } from "@/lib/design-render";
import {
  assignReviewerAction,
  deleteBlogCommentAction,
  resolveBlogCommentAction,
} from "@/app/actions/blog-review";
import {
  applySlugConventionAction,
  generatePublisherNotesAction,
  suggestExternalLinkAction,
} from "@/app/actions/blog-publish-prep";
import {
  approveBlogImageAction,
  attachBlogImageAction,
  placeBlogImageAction,
  deleteBlogImageAction,
  generateBlogImageAction,
  generateImageBriefsAction,
  remeasureBlogImageAction,
  saveImageAltAction,
} from "@/app/actions/blog-images";
import { modelChoices, resolveUsableModel } from "@/lib/llm";
import { modelLabel } from "@/lib/llm/models";
import { ModelOptions, ModelChoiceNote } from "@/components/ModelOptions";
import {
  applyTitleAction,
  generateAltTextAction,
  generateMetaAction,
  generateOutlineAction,
  generateTitlesAction,
  regenerateSectionAction,
  saveOutlineAction,
} from "@/app/actions/blog-craft";
import {
  addFaqSectionAction,
  addKeyTakeawaysAction,
} from "@/app/actions/blog-optimize";
import { FindingCards } from "@/components/FindingCards";
import { getSearchProvider } from "@/lib/search";
import { SubmitButton } from "@/components/SubmitButton";
import { BlogBodyEditor } from "@/components/BlogBodyEditor";
import { anchorPresent, mentionHandles, mentionSegments } from "@/lib/comment-anchors";
import { stripExecutableHtml } from "@/lib/html-safety";
import { displayTimeZone } from "@/lib/display-zone";
import { AnchoredCommentForm, CommentableText } from "./CommentAnchors";
import {
  addCitationAction,
  advanceBlogStatusAction,
  clearGateOverrideAction,
  deleteBlogPostAction,
  deleteCitationAction,
  generateBlogDraftAction,
  restoreBlogVersionAction,
  scheduleBlogPostAction,
  updateBlogPostAction,
  verifyCitationAction,
} from "@/app/actions/blog";
import { checkLiveSocialTagsAction, publishToWordPressAction, pushSeoMetaAction } from "@/app/actions/blog-wp";
import type { LiveHead } from "@/lib/live-head";
import { markPublishedManuallyAction } from "@/app/actions/blog-export";
import {
  deleteSocialVariantAction,
  generateSocialVariantsAction,
  setSocialVariantStatusAction,
  postSocialVariantAction,
} from "@/app/actions/blog-social";
import { createVideoPackageAction } from "@/app/actions/videos";
import { renderBrandedShortAction, deleteBrandedShortAction } from "@/app/actions/branded-video";
import { brandedShortReadiness } from "@/lib/branded-video";
import { HelpTip } from "@/components/HelpTip";
import { resolveImageProviderName } from "@/lib/images";
import { BLOG_EDITOR_TAB_TIPS, BLOG_EDITOR_TIPS, IMAGE_TIPS } from "@/lib/help-tips";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { actorRecordedFrom, versionActor } from "@/lib/version-actor";
import { SearchSocialPreview } from "./SearchSocialPreview";
import { ArticlePerformance } from "./ArticlePerformance";
import { InternalLinks } from "./InternalLinks";
import { ReadabilityCoach } from "./ReadabilityCoach";

// Blog post editor (Spark port, slice 1): SEO metadata + HTML body + grounded
// AI draft + the review-state machine. Publishing is an ADMIN act (human gate).

function parseCsvJson(json: string): string[] {
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const FLOW = ["drafting", "draft_review", "final_approval", "published"] as const;
const FLOW_LABELS: Record<(typeof FLOW)[number], string> = {
  drafting: "Drafting",
  draft_review: "Draft review",
  final_approval: "Final approval",
  published: "Published",
};

const TABS = [
  { key: "write", label: "Write" },
  { key: "optimize", label: "Optimize" },
  { key: "assets", label: "Assets" },
  { key: "distribute", label: "Distribute" },
  { key: "review", label: "Review" },
  // E-MEA-06: how it is doing — search by day, and the social posts that pointed here.
  { key: "performance", label: "Performance" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function BlogPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; social_ok?: string; social_err?: string; flash?: string; flashErr?: string; pv?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.some((t) => t.key === sp.tab) ? sp.tab : "write") as TabKey;
  const is = (k: TabKey) => tab === k;
  const { workspace, membership } = await requireMembership();
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      citations: { orderBy: { createdAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      images: true,
      variants: { orderBy: { platform: "asc" } },
      _count: { select: { socialIdeas: true } },
      versions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!post) notFound();
  const wpConn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  // Publish times are typed and shown in the posting timezone — the zone the
  // schedule action reads them in (ART-04). The server's own clock is UTC.
  const tz = await getPostingTimeZone(workspace.id);

  // Branded shorts (HyperFrames) — how a render would run + this post's renders.
  const [brandedReadiness, brandedShorts] = await Promise.all([
    brandedShortReadiness(workspace.id),
    db.brandedShort.findMany({
      where: { workspaceId: workspace.id, blogPostId: id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const imageProviderName = await resolveImageProviderName(workspace.id);

  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const idx = FLOW.indexOf(post.status as (typeof FLOW)[number]);
  const nextIsPublish = FLOW[idx + 1] === "published";
  // A refresh of an article published by hand goes out by hand, even with a
  // website connected — WordPress would make it a second article.
  const handRefresh = post.refreshStartedAt != null && post.wpPostId == null;
  const unverified = post.citations.filter((c) => !c.verified).length;
  // FR-8: the asset gate rides in the same checks list the publish flow uses.
  const [assets, brand, briefs, editorial] = await Promise.all([
    loadAssetGate(workspace.id, post.id),
    getBrandKit(workspace.id),
    getImageBriefs(post.id),
    loadEditorialContext(workspace.id, post),
  ]);
  const { overlapChecks } = await import("@/lib/blog-overlap");
  // Advisory, never part of the gate (E-ART-13): another article on the same keyword or slug.
  const checks = [...runBlogChecks(post, unverified, assets, editorial), ...(await overlapChecks(post))];
  const gatesPass = gatesSatisfied(post, checks);
  // Passing only because an admin's override covers this exact body (ART-09):
  // the sidebar must say so rather than "All gates pass" beside red ✕s.
  const failingCount = checks.filter((c) => c.required && !c.pass).length;
  const overridden = overrideHolds(post) && failingCount > 0;
  const score = contentScore(post, checks);
  const [titlesSetting, linksSetting, findings, searchInfo] = await Promise.all([
    db.setting.findUnique({ where: { key: `blog:titles:${post.id}` } }),
    db.setting.findUnique({ where: { key: `blog:links:${post.id}` } }),
    // Optimize → "Address these": the article's finding cards (all states —
    // the component folds resolved ones away).
    db.blogFinding.findMany({ where: { postId: post.id }, orderBy: { createdAt: "asc" } }),
    getSearchProvider(workspace.id),
  ]);
  let titleVariants: string[] = [];
  try { titleVariants = titlesSetting ? (JSON.parse(titlesSetting.value) as string[]) : []; } catch { titleVariants = []; }
  let linkSuggestions: Array<{ url: string; anchorText: string }> = [];
  try { linkSuggestions = linksSetting ? JSON.parse(linksSetting.value) : []; } catch { linkSuggestions = []; }
  let outline: Array<{ heading: string; points: string[] }> = [];
  try { outline = post.outline ? JSON.parse(post.outline) : []; } catch { outline = []; }
  let secondaryKw: string[] = [];
  try { secondaryKw = JSON.parse(post.secondaryKeywords) as string[]; } catch { secondaryKw = []; }
  // Motif voice (FR-2): the post's own blend, plus what it would inherit.
  // FR-7 publish prep: slug convention, external sources, last publish report.
  const slugRules = parseSlugRules(wpConn?.slugRules);
  const conventionalSlug = applySlugConvention(post.slug || post.metaTitle || post.title, slugRules);
  const slugOk = slugMatchesConvention(post.slug, slugRules);
  const externalSetting = await db.setting.findUnique({ where: { key: `blog:external:${post.id}` } });
  let externalLinks: { real: boolean; results: Array<{ title: string; url: string; snippet: string }> } = {
    real: false,
    results: [],
  };
  try {
    if (externalSetting) externalLinks = JSON.parse(externalSetting.value);
  } catch {
    externalLinks = { real: false, results: [] };
  }
  let publishReport: {
    status: string;
    draftLink?: string;
    seo: Array<{ key: string; accepted: boolean; stored: string | null }>;
    seoUnverified: boolean;
    featuredUploadFailed: boolean;
    featuredUploadError?: string | null;
    categories: { missed: string[] };
    tags: { missed: string[] };
    ogImageUrl?: string | null;
    ogUploadError?: string | null;
    liveHead?: LiveHead | null;
  } | null = null;
  try {
    publishReport = post.publishReport ? JSON.parse(post.publishReport) : null;
  } catch {
    publishReport = null;
  }
  // FR-18: what publishing will actually send, mapped to the site's design system.
  const renderProfile = isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html";
  const renderPreview = post.body
    ? renderForPublish(post.body, {
        headingSpec: brand.headingSpec,
        footerCredit: brand.footerCredit,
        renderProfile,
        renderRules: parseRenderRules(brand.renderRules),
      })
    : { html: "", report: { checklist: 0, callout: 0, quote: 0, faq: 0, cta: 0, separator: 0 } };
  const categories = parseCsvJson(post.categories);
  const tags = parseCsvJson(post.tags);
  // FR-10 review: who can be assigned, and who wrote each comment.
  const members = await db.membership.findMany({
    where: { workspaceId: workspace.id, status: "active" },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { userId: "asc" },
  });
  const memberName = new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email ?? m.userId]));
  const commentAuthor = (authorId: string | null) => (authorId ? (memberName.get(authorId) ?? "someone") : "system");
  const actorSince = post.versions.length ? await actorRecordedFrom() : null;
  // Search and social previews (E-ART-06): the site the result points at, the
  // text Google would pick with no description, and the card image — the
  // approved OG image, else the approved featured one (as the export does).
  const previewSite = wpConn?.baseUrl ?? (post.publishedUrl ? (() => { try { return new URL(post.publishedUrl!).origin; } catch { return null; } })() : null);
  const previewExcerpt = (post.body ?? "").replace(/<h[1-6][\s\S]*?<\/h[1-6]>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 320);
  const approvedImages = post.images.filter((i) => i.status === "approved");
  const previewImage = approvedImages.find((i) => i.role === "og") ?? approvedImages.find((i) => i.role === "featured") ?? null;
  const openComments = post.comments.filter((c) => !c.resolved).length;
  // E-ART-17: the frame's width, and WordPress's own preview of a draft hand-off
  // (until the article goes live, when the draft link is history).
  const pvPhone = sp.pv === "phone";
  const wpDraftPreview = (() => {
    if (!publishReport?.draftLink || post.status === "published") return null;
    try {
      const u = new URL(publishReport.draftLink);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.searchParams.set("preview", "true");
      return u.toString();
    } catch {
      return null;
    }
  })();
  // E-ART-15: the article's text to quote from (no scripts), the open comments'
  // passages still in it, and who can be @mentioned.
  const commentHtml = tab === "review" && post.body ? stripExecutableHtml(post.body) : null;
  const commentMarks = post.comments.filter((c) => !c.resolved && c.anchor && anchorPresent(post.body, c.anchor)).map((c) => ({ id: c.id, text: c.anchor! }));
  const mentionHandlesById = new Map(members.map((m) => [m.userId, mentionHandles({ userId: m.userId, name: m.user.name, email: m.user.email })]));
  const mentionOptions = members
    .filter((m) => m.userId !== membership.userId)
    .map((m) => {
      const handles = mentionHandlesById.get(m.userId) ?? [];
      return { userId: m.userId, label: m.user.name ? `${m.user.name}${m.user.email ? ` · ${m.user.email}` : ""}` : (m.user.email ?? m.userId), insert: handles[0] ?? m.userId, handles };
    })
    .filter((m) => m.handles.length > 0);
  // E-SHL-09: comment times in the reader's own zone (schedules on this page keep the posting zone).
  const readTz = await displayTimeZone(workspace.id);
  // E-ART-18: what the editor's toolbar can insert — this article's images and
  // the workspace's media, and the site's own live articles to link to.
  const [mediaItems, liveArticles] = editor
    ? await Promise.all([
        db.mediaItem.findMany({ where: { workspaceId: workspace.id, OR: [{ contentType: { startsWith: "image/" } }, { contentType: null }] }, orderBy: { createdAt: "desc" }, take: 24, select: { key: true, name: true, description: true } }),
        db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null }, id: { not: post.id } }, orderBy: { publishedAt: "desc" }, take: 200, select: { title: true, publishedUrl: true } }),
      ])
    : [[], []];
  const { storage } = await import("@/lib/storage");
  const editorExtras = {
    media: [
      ...post.images.filter((i) => i.url).map((i) => ({ url: i.url, alt: i.altText ?? null, label: i.role === "og" ? "OG image" : i.role === "featured" ? "Featured image" : i.role })),
      ...mediaItems.map((m) => ({ url: storage.url(m.key), alt: m.description ?? null, label: m.name })),
    ],
    links: liveArticles.map((a) => ({ title: a.title, url: a.publishedUrl! })),
  };
  const commentPolicy = { block: (await db.brandKit.findUnique({ where: { workspaceId: workspace.id }, select: { blockOnOpenComments: true } }))?.blockOnOpenComments ?? false };

  const [modelChoiceList, inheritedModel, postModelRuns] = await Promise.all([
    modelChoices(workspace.id),
    resolveUsableModel("", workspace.id),
    resolveUsableModel(post.model ?? "", workspace.id),
  ]);
  // FR-3: the expert roster, plus who would be auto-matched if none is pinned.
  const [experts, matchedSme, topics] = await Promise.all([
    // Only real experts can be spoken as — never an audience persona (E-IDE-14).
    db.smeProfile.findMany({
      where: { workspaceId: workspace.id, status: "active", kind: "expert" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    selectSmeProfile(workspace.id, post),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const postMotifs = parseMotifs(post.motifs);
  const [directives, effectiveMotifs] = await Promise.all([
    ensureMotifDirectives(workspace.id),
    resolveMotifs(workspace.id, post),
  ]);

  // Which tab carries a badge worth surfacing?
  const tabBadges: Partial<Record<TabKey, { n: number; urgent: boolean }>> = {
    review: { n: unverified + openComments, urgent: unverified > 0 },
    assets: {
      n: 2 - ["featured", "og"].filter((r) => post.images.some((i) => i.role === r && i.status === "approved")).length,
      urgent: true,
    },
  };

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All posts
      </Link>

      {/* State rail */}
      <div className="card mb-4 flex flex-wrap items-center gap-2">
        {FLOW.map((s, i) => (
          <span
            key={s}
            className="text-2xs font-mono font-semibold px-2 py-0.5 rounded-full"
            style={
              i === idx
                ? { background: "var(--accent-soft)", color: "var(--accent-on)" }
                : { background: "var(--panel)", color: "var(--mute)" }
            }
          >
            {i + 1}. {FLOW_LABELS[s]}
          </span>
        ))}
        <span className="flex-1" />
        {editor && idx > 0 && post.status !== "published" && (
          <form action={advanceBlogStatusAction}>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="dir" value="back" />
            <button className="btn" title="Send back a stage"><ChevronLeft className="w-4 h-4" /> Back</button>
          </form>
        )}
        {/* No website: the app can't publish this itself, so the publish step is
            the hand-made one — the HTML file, then the live link (ART-12). The
            old button marked it published with no URL. */}
        {admin && nextIsPublish && (!wpConn || handRefresh) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <a href={`/blog/${post.id}/export`} className="btn" title={handRefresh ? "A self-contained HTML file of this revision — replace the live page with it" : "A self-contained HTML file of this article — add it to your site by hand"}>Download HTML</a>
            <form action={markPublishedManuallyAction} className="flex items-center gap-1.5">
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="back" value="editor" />
              <input name="url" type="url" required defaultValue={handRefresh ? post.publishedUrl ?? undefined : undefined} placeholder="https://… live link" className="text-xs min-w-52" aria-label="Live URL" />
              <SubmitButton className="btn primary" pendingText="Recording…" title={handRefresh ? "Record that the live page now has this revision" : "Record this article as published at that link — social posts and analytics key off it"}>{handRefresh ? "Mark as refreshed" : "Mark as published"}</SubmitButton>
            </form>
          </div>
        )}
        {editor && idx < FLOW.length - 1 && (!nextIsPublish || (admin && wpConn && !handRefresh)) && (
          <form action={advanceBlogStatusAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className={nextIsPublish ? "btn primary" : "btn"} title={nextIsPublish ? "Publish (admin approval)" : "Advance a stage"}>
              {nextIsPublish ? "Approve & publish" : "Advance"} <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        )}
        {editor && nextIsPublish && !admin && (
          <span className="text-xs text-[var(--mute)]">Publishing needs an admin</span>
        )}
      </div>

      {sp.flash && <Banner kind="ok" text={sp.flash} />}
      {sp.flashErr && <Banner kind="err" text={sp.flashErr} />}

      {/* "Advance anyway", on the record — who, when, why, and whether it
          still covers the text (ART-09). */}
      {post.gateOverrideAt && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 text-xs" style={{ borderColor: "var(--amber-on)" }}>
          <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "var(--amber-on)" }} />
          <span>
            <span className="font-semibold">Checks overridden</span> by {(post.gateOverrideById && memberName.get(post.gateOverrideById)) || "an admin"} on{" "}
            {formatInZone(post.gateOverrideAt, tz)}
            {post.gateOverrideReason ? <> — “{post.gateOverrideReason}”</> : null}.{" "}
            {overrideHolds(post)
              ? failingCount > 0 ? `It covers this text, so ${failingCount} failing check${failingCount === 1 ? "" : "s"} won't hold it.` : "Every check passes now anyway."
              : "It no longer applies: the text changed after it, so the checks decide again."}
          </span>
          <span className="flex-1" />
          {admin && (
            <form action={clearGateOverrideAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn sm" pendingText="Clearing…" title="Take the override back — at final approval an article that needed it goes back to review">Clear override</SubmitButton>
            </form>
          )}
        </div>
      )}

      {/* Editor tabs — each is a focused pane; the gates sidebar stays put. */}
      <nav aria-label="Editor sections" className="flex items-center gap-0.5 border-b border-[var(--line)] mb-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          const badge = tabBadges[t.key];
          return (
            <Link
              key={t.key}
              href={`/blog/${post.id}?tab=${t.key}`}
              aria-current={on ? "page" : undefined}
              // Native title, not a bubble: this strip is overflow-x-auto.
              title={BLOG_EDITOR_TAB_TIPS[t.key]}
              className="group relative inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap"
              style={{ color: on ? "var(--rose)" : "var(--slate)" }}
            >
              {t.label}
              {badge && badge.n > 0 && (
                <span
                  className="font-mono text-micro font-bold rounded-full px-1.5 py-px"
                  style={badge.urgent ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--panel)", color: "var(--mute)" }}
                >
                  {badge.n}
                </span>
              )}
              <span
                aria-hidden
                className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t transition-transform duration-200 ease-out group-hover:scale-x-100"
                style={{ background: "var(--rose)", transform: on ? "scaleX(1)" : "scaleX(0)" }}
              />
            </Link>
          );
        })}
      </nav>

      {/* Collapsed gates strip — when the sidebar doesn't fit (narrow viewport
          OR XL content-size shrinking effective width), the publish contract
          stays one glance away instead of vanishing into the Review tab. */}
      <Link
        href={`/blog/${post.id}?tab=review`}
        className="@4xl:hidden card !p-2.5 mb-4 flex items-center gap-2 text-xs font-semibold hover:border-[var(--accent)] transition-colors"
        title="Open the Review tab for gate details"
      >
        <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: gatesPass ? "var(--green-on)" : "var(--amber-on)" }} />
        <span className="font-mono uppercase tracking-wider text-[var(--mute)] text-2xs">Gates</span>
        <span className="font-mono text-2xs" style={{ color: gatesPass ? "var(--green-on)" : undefined }}>
          {checks.filter((c) => c.required && c.pass).length}/{checks.filter((c) => c.required).length} pass
        </span>
        <span className="flex-1" />
        {overridden ? (
          <span className="font-mono text-micro font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>overridden</span>
        ) : gatesPass ? (
          <span className="font-mono text-micro font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>ready</span>
        ) : (
          <span className="font-mono text-micro font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            {checks.filter((c) => c.required && !c.pass).length} blocking
          </span>
        )}
        <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>score {score.total}</span>
      </Link>

      {/* Sidebar breakpoint matches the aside below — previously the grid
          reserved its 270px column from lg while the aside only appeared at
          xl, leaving a phantom empty column between the two. */}
      <div className="grid grid-cols-1 @4xl:grid-cols-[1fr_270px] gap-4 items-start">
      <div className="min-w-0">

      {is("performance") && <ArticlePerformance postId={post.id} workspaceId={workspace.id} publishedUrl={post.publishedUrl} timeZone={tz} />}

      {is("distribute") && (<>
      {sp.social_ok && (
        <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Posted to the connected account.
        </div>
      )}
      {sp.social_err && (
        <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <CircleAlert className="w-4 h-4 shrink-0" style={{ color: "var(--rose-on)" }} /> {sp.social_err}
        </div>
      )}
      {/* Scheduled publishing — setting a time at final approval IS the human
          approval; autopilot (assisted or auto) publishes when due. */}
      {post.status === "final_approval" && admin && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 text-sm">
          <b>Schedule:</b>
          {post.scheduledAt ? (
            <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
              publishes {formatInZone(post.scheduledAt, tz)} {tz}
            </span>
          ) : (
            <span className="text-xs text-[var(--mute)]">not scheduled</span>
          )}
          <span className="flex-1" />
          <form action={scheduleBlogPostAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={post.id} />
            <input
              type="datetime-local"
              name="scheduledAt"
              defaultValue={post.scheduledAt ? toZonedInput(post.scheduledAt, tz) : ""}
              className="text-xs font-mono"
            />
            <span className="font-mono text-2xs text-[var(--mute)]">{tz}</span>
            <button className="btn">Set</button>
          </form>
          {post.scheduledAt && (
            <form action={scheduleBlogPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="scheduledAt" value="" />
              <button className="btn">Clear</button>
            </form>
          )}
        </div>
      )}

      {/* WordPress publish (FR-11) — appears from final approval onward */}
      {(post.status === "final_approval" || post.status === "published") && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 text-sm">
          <b>WordPress:</b>
          {post.publishedUrl ? (
            <>
              <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="underline text-[var(--blue-on)] break-all">
                {post.publishedUrl}
              </a>
              <span className="flex-1" />
              {/* A refresh: the live post stays as it is until this revision
                  is published, which replaces it in place at the same URL. */}
              {post.refreshStartedAt && (
                <span className="text-xs text-[var(--mute)]">
                  {handRefresh
                    ? "Being refreshed — the live page stays as it is until you replace it with this revision (Download HTML) and mark it refreshed."
                    : "Being refreshed — the live version stays until this revision is published."}
                </span>
              )}
              {admin && wpConn && !handRefresh && post.refreshStartedAt && post.status === "final_approval" && (
                <form action={publishToWordPressAction}>
                  <input type="hidden" name="postId" value={post.id} />
                  <SubmitButton className="btn primary" pendingText="Publishing…">Publish the revision</SubmitButton>
                </form>
              )}
              {/* Published is exactly when re-pushing meta matters (the SEO
                  plugin choice changed after the article went out) — the
                  button must live in THIS branch, not the unpublished one. */}
              {/* E-ART-02: see what would change on the live post, and push it. */}
              {wpConn && post.wpPostId != null && post.status === "published" && !post.refreshStartedAt && (
                <Link href={`/blog/${post.id}/update`} className="btn sm" data-update-link="">Update on WordPress…</Link>
              )}
              {/* E-IDE-04: fold it into another article, or take it down, without a dead end. */}
              {post.status === "published" && post.publishedUrl && (
                <Link href={`/blog/${post.id}/retire`} className="btn sm" data-retire-link="">{post.retiredAt ? "Retired — see the checklist" : "Retire or merge…"}</Link>
              )}
              {admin && wpConn && post.wpPostId != null && (
                <form action={pushSeoMetaAction}>
                  <input type="hidden" name="postId" value={post.id} />
                  <SubmitButton className="btn sm" pendingText="Pushing…">Re-push SEO meta</SubmitButton>
                </form>
              )}
            </>
          ) : wpConn ? (
            <>
              <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={wpConn.status === "connected" ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                {wpConn.status}
              </span>
              <span className="flex-1" />
              {admin && (
                <>
                  <form action={publishToWordPressAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="dryRun" value="1" />
                    <SubmitButton className="btn" pendingText="Testing…">Dry run</SubmitButton>
                  </form>
                  <form action={publishToWordPressAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <SubmitButton className="btn primary" pendingText="Publishing…">Publish to WordPress</SubmitButton>
                  </form>
                  {post.wpPostId != null && (
                    // For posts already on the site: send the current SEO
                    // metadata to the plugin's fields (e.g. after switching
                    // the SEO plugin on Distribute → Website). Reads back and
                    // reports what the site actually stored.
                    <form action={pushSeoMetaAction}>
                      <input type="hidden" name="postId" value={post.id} />
                      <SubmitButton className="btn" pendingText="Pushing…">Re-push SEO meta</SubmitButton>
                    </form>
                  )}
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--mute)]">
              No site connected — <Link href="/website" className="underline">connect WordPress</Link> to publish directly.
            </span>
          )}
        </div>
      )}

      {post.publishedUrl && (
        // What the live page tells Facebook, LinkedIn and X (E-ART-05) —
        // stored by the SEO plugin is not the same as shown on the page.
        <div className="card mb-4 text-xs" data-live-head>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-xs font-semibold m-0">On the live page</h3>
            <span className="text-[var(--mute)]">
              {publishReport?.liveHead
                ? <>checked {formatZonedMoment(new Date(publishReport.liveHead.at), readTz)}</>
                : "not checked yet"}
            </span>
            <span className="flex-1" />
            {editor && wpConn && (
              <form action={checkLiveSocialTagsAction}>
                <input type="hidden" name="postId" value={post.id} />
                <SubmitButton className="btn sm" pendingText="Reading the page…" title="Read the article's page on the site and check the tags networks use for the share card">Check the live page</SubmitButton>
              </form>
            )}
          </div>
          {publishReport?.liveHead?.error ? (
            <p className="m-0" style={{ color: "var(--amber-on)" }}>{publishReport.liveHead.error}</p>
          ) : publishReport?.liveHead?.checks ? (
            <ul className="flex flex-col gap-1 m-0 p-0 list-none">
              {publishReport.liveHead.checks.map((c) => (
                <li key={c.tag} className="flex items-start gap-2" data-live-tag={c.tag} data-state={c.state}>
                  {c.state === "ok" ? (
                    <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
                  ) : c.state === "warn" ? (
                    <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--amber-on)" }} />
                  ) : (
                    <X className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--rose-on)" }} />
                  )}
                  <span><span className="font-mono">{c.tag}</span> <span className="text-[var(--mute)]">· {c.note}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[var(--mute)]">Published before the page was read after each publish — check it to see what the share card will use.</p>
          )}
        </div>
      )}

      </>)}

      {is("review") && (<>
      {/* E-IDE-04: a refresh is re-reviewed against what's live now. */}
      {post.refreshStartedAt && post.wpPostId != null && (await (async () => {
        const cmp = await compareWithLive(workspace.id, post.id, { refresh: true });
        return (
          <details className="card mb-4" data-refresh-diff="" open>
            <summary className="cursor-pointer select-none text-sm font-semibold">What this refresh changes against the live article</summary>
            {!cmp.ok ? (
              <p className="text-xs text-[var(--mute)] mt-2 mb-0">{cmp.error}</p>
            ) : cmp.unchanged ? (
              <p className="text-xs text-[var(--mute)] mt-2 mb-0" data-refresh-unchanged="">Nothing yet — the revision reads the same as the live article.</p>
            ) : (
              <>
                <p className="text-xs mt-2" data-refresh-stats={`${cmp.stats.added}/${cmp.stats.removed}`}>
                  <b>{cmp.stats.added}</b> word{cmp.stats.added === 1 ? "" : "s"} added, <b>{cmp.stats.removed}</b> removed
                  {cmp.title.changed && <> · the title changes</>}{cmp.excerpt.changed && <> · the description changes</>}
                  {cmp.imagesChanged.length > 0 && <> · new {cmp.imagesChanged.join(" and ")}</>} — read against the post on the site now.
                </p>
                {(cmp.stats.added > 0 || cmp.stats.removed > 0) && <DiffRows rows={cmp.rows} />}
              </>
            )}
          </details>
        );
      })())}
      {/* Pre-publish checks (Spark gates — server-enforced on advance) */}
      <details className="card mb-4" open={!gatesPass}>
        {/* `title` on the summary rather than a <HelpTip> inside it — a button
            in a <summary> toggles the <details> when clicked. */}
        <summary title={BLOG_EDITOR_TIPS.gates} className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
          <ShieldCheck className="w-4 h-4" style={{ color: gatesPass ? "var(--green-on)" : "var(--amber-on)" }} />
          Publish gates: {checks.filter((c) => c.required && c.pass).length}/{checks.filter((c) => c.required).length} required checks pass
          <span
            className="font-mono text-xs px-2 py-0.5 rounded-full"
            style={
              score.total >= 75
                ? { background: "var(--green-soft)", color: "var(--green-on)" }
                : score.total >= 50
                  ? { background: "var(--amber-soft)", color: "var(--amber-on)" }
                  : { background: "var(--rose-soft)", color: "var(--rose-on)" }
            }
            title={`${BLOG_EDITOR_TIPS.score}\n\n${score.parts.map((p) => `${p.label} ${p.score}/${p.max}${p.detail ? ` (${p.detail})` : ""}`).join(" · ")}`}
          >
            content score {score.total}/100
          </span>
          {!gatesPass && <span className="text-xs font-normal text-[var(--mute)]">— advancing to approval/publish is blocked</span>}
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5 text-micro font-mono">
          {score.parts.map((p) => (
            <span key={p.label} className="px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }} title={p.detail}>
              {p.label} {p.score}/{p.max}
            </span>
          ))}
          <span className="px-1.5 py-0.5 text-[var(--mute)]">not SERP-comparative — needs a search-data provider</span>
        </div>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              {c.pass ? (
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
              ) : c.required ? (
                <X className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--rose-on)" }} />
              ) : (
                <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--amber-on)" }} />
              )}
              <span>
                {c.label}
                {c.detail ? <span className="text-[var(--mute)]"> · {c.detail}</span> : null}
                {!c.required && <span className="text-[var(--mute)]"> (advisory)</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* E-ART-17: the article in a real page of the site, as readers will see it. */}
      <details className="card mb-4" id="site-preview" data-site-preview-card="" open={!!sp.pv}>
        <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
          <MonitorSmartphone className="w-4 h-4" />
          How it will look on the site
          {previewSite && <span className="font-mono text-micro font-normal text-[var(--mute)]">{previewSite.replace(/^https?:\/\//, "")}</span>}
        </summary>
        <p className="text-xs text-[var(--mute)] mt-2">
          {previewSite
            ? "This article — rendered exactly as publishing sends it — inside a real page of the site, borrowed from your newest live article there (or the home page), so the theme's fonts, widths and header show. Scripts don't run in the preview, so menus and sliders sit still; the bar at the top says which page the look came from."
            : "No site is connected yet, so this is a plain readable page. Connect WordPress on the Website page to preview in your theme."}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs mt-2">
          <Link href={`/blog/${post.id}?tab=review&pv=desktop#site-preview`} className={`btn sm ${!pvPhone ? "primary" : ""}`} aria-current={!pvPhone ? "true" : undefined}>Desktop</Link>
          <Link href={`/blog/${post.id}?tab=review&pv=phone#site-preview`} className={`btn sm ${pvPhone ? "primary" : ""}`} aria-current={pvPhone ? "true" : undefined}>Phone</Link>
          <a href={`/api/blog-preview/${post.id}`} target="_blank" rel="noopener" className="underline">Open full size</a>
          {wpDraftPreview && (
            <a href={wpDraftPreview} target="_blank" rel="noreferrer noopener" className="underline" data-wp-draft-preview="">
              WordPress&apos;s own preview of the draft (sign in to WordPress to see it)
            </a>
          )}
        </div>
        <div className="mt-2 flex justify-center rounded-lg overflow-hidden p-2" style={{ background: "var(--panel)" }}>
          <iframe
            title="The article as it will look on the site"
            src={`/api/blog-preview/${post.id}`}
            sandbox="allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
            data-site-preview-frame={pvPhone ? "phone" : "desktop"}
            className="block bg-white rounded"
            style={{ width: pvPhone ? 390 : "100%", maxWidth: "100%", height: 760, border: 0 }}
          />
        </div>
      </details>

      </>)}

      {is("optimize") && (<>
      {/* Publish prep (FR-7): slug rule, external source, publisher notes, and
          the read-back of what WordPress actually stored last time. */}
      {editor && (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold mb-2">Publish prep</h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <form action={applySlugConventionAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Applying…">
                Apply slug rule{conventionalSlug ? ` → ${conventionalSlug}` : ""}
              </SubmitButton>
            </form>
            <form action={suggestExternalLinkAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Searching…">Suggest external source</SubmitButton>
            </form>
            <form action={generatePublisherNotesAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Assembling…">
                {post.publisherNotes ? "Refresh publisher notes" : "Generate publisher notes"}
              </SubmitButton>
            </form>
            {!slugOk && post.slug && (
              <span className="font-mono text-micro px-2 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                slug is off-convention
              </span>
            )}
          </div>

          {externalLinks.results.length > 0 && (
            <div className="mb-3">
              <h3 className="text-xs font-semibold mb-1">
                External source candidates{" "}
                {!externalLinks.real && (
                  <span className="font-mono text-micro text-[var(--mute)]">mock results — add a search key</span>
                )}
              </h3>
              <ul className="text-xs flex flex-col gap-1">
                {externalLinks.results.map((r) => (
                  <li key={r.url} className="border-b border-[var(--line)] pb-1 last:border-0">
                    <a href={r.url} target="_blank" rel="noreferrer noopener" className="underline">{r.title}</a>
                    <span className="text-[var(--mute)]"> · {r.snippet.slice(0, 120)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-[var(--mute)] mt-1">
                Suggestions only — a link is an editorial endorsement, so place it yourself.
              </p>
            </div>
          )}

          {post.body && (
            <details className="text-xs mb-3">
              <summary className="cursor-pointer font-semibold">
                Rendered output{" "}
                <span className="font-mono text-micro text-[var(--mute)]">
                  {PROFILE_LABELS[renderProfile]} · {reportSummary(renderPreview.report)}
                </span>
              </summary>
              <p className="text-2xs text-[var(--mute)] mt-1">
                What publishing will actually send, after the design-system mapping and the heading spec. The stored
                draft stays clean HTML.
              </p>
              <pre className="mt-1 p-2 rounded-lg overflow-x-auto text-micro leading-relaxed" style={{ background: "var(--panel)" }}>
                {renderPreview.html.slice(0, 4000)}
                {renderPreview.html.length > 4000 ? "\n…truncated" : ""}
              </pre>
            </details>
          )}

          {post.publisherNotes && (
            <div className="mb-3">
              <h3 className="text-xs font-semibold mb-1">Notes for the publisher</h3>
              <pre className="text-xs whitespace-pre-wrap font-sans">{post.publisherNotes}</pre>
            </div>
          )}

          {publishReport && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold">
                Last publish report{" "}
                <span className="font-mono text-micro text-[var(--mute)]">
                  {publishReport.status} · {publishReport.seo.filter((s) => s.accepted).length}/{publishReport.seo.length} SEO fields stored
                </span>
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {publishReport.seo.map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    {s.accepted ? (
                      <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
                    ) : (
                      <X className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--rose-on)" }} />
                    )}
                    <span>
                      <span className="font-mono">{s.key}</span>
                      <span className="text-[var(--mute)]">
                        {" "}
                        · {s.accepted ? "stored" : s.stored === null ? "not stored (key may not be REST-registered)" : `stored a different value`}
                      </span>
                    </span>
                  </li>
                ))}
                {publishReport.seo.length === 0 && (
                  <li className="text-[var(--mute)]">No SEO plugin mapped — only the post content was sent.</li>
                )}
                {publishReport.ogImageUrl ? (
                  <li className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
                    <span>OG image <span className="text-[var(--mute)]">· public at <a href={publishReport.ogImageUrl} target="_blank" rel="noreferrer" className="underline break-all">{publishReport.ogImageUrl}</a></span></span>
                  </li>
                ) : publishReport.ogUploadError ? (
                  <li style={{ color: "var(--rose-on)" }}>OG image upload to the media library failed: {publishReport.ogUploadError}. Shares use the featured image instead.</li>
                ) : null}
                {publishReport.featuredUploadFailed && (
                  <li style={{ color: "var(--rose-on)" }}>Featured image upload to the media library failed{publishReport.featuredUploadError ? `: ${publishReport.featuredUploadError}` : ""}. The post is live without it — set the featured image in WordPress by hand, or fix the cause (a host upload limit, a bad file) before the next publish.</li>
                )}
                {publishReport.categories.missed.length > 0 && (
                  <li style={{ color: "var(--amber-on)" }}>Categories not applied: {publishReport.categories.missed.join(", ")}</li>
                )}
                {publishReport.tags.missed.length > 0 && (
                  <li style={{ color: "var(--amber-on)" }}>Tags not applied: {publishReport.tags.missed.join(", ")}</li>
                )}
                {publishReport.seoUnverified && (
                  <li style={{ color: "var(--amber-on)" }}>
                    Could not read the post back — the results above are what we sent, not what WordPress stored.
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      </>)}

      {is("assets") && (<>
      {/* Images (FR-8): featured + branded OG, at the workspace's dimensions. */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold flex-1 flex items-center gap-1.5">
            Images{" "}
            <span className="font-mono text-xs text-[var(--mute)]">
              {post.images.filter((i) => i.status === "approved").length}/2 ready
            </span>
            {/* Only while the mock is resolving. requireImagesToPublish
                defaults ON, so with no provider the gate sits in front of an
                image that could only ever be a stock photo — worth saying
                here, and worth NOT saying once a real provider is on. */}
            {imageProviderName === "mock" && <HelpTip text={IMAGE_TIPS.notWired} side="bottom" wide />}
          </h2>
          {!brand.requireImagesToPublish && (
            <span className="font-mono text-micro px-2 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
              gate off — advisory only
            </span>
          )}
          {editor && (
            <form action={generateImageBriefsAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Briefing…">
                <Sparkles className="w-3.5 h-3.5" /> {briefs.featured || briefs.og ? "Regenerate briefs" : "Generate image briefs"}
              </SubmitButton>
            </form>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {IMAGE_ROLES.map((role) => {
            const img = post.images.find((i) => i.role === role);
            const spec = specFor(role, brand);
            const brief = role === "featured" ? briefs.featured : briefs.og;
            const verdict = img ? dimensionVerdict(img, spec) : null;
            const hue = verdict?.state === "ok" ? "green" : verdict?.state === "mismatch" ? "rose" : "amber";
            return (
              <div key={role} className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold flex-1">{ROLE_LABELS[role]}</span>
                  <span className="font-mono text-micro text-[var(--mute)]">{spec.width}×{spec.height}</span>
                </div>

                {img ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.altText ?? ""} className="w-full rounded-lg border border-[var(--line)] object-cover max-h-40" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
                        {verdict?.detail}
                      </span>
                      <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                        {img.source}
                      </span>
                      {img.status === "pending" && (
                        <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                          awaiting review
                        </span>
                      )}
                      {img.branded && (
                        <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
                          branded
                        </span>
                      )}
                    </div>
                    {editor && (
                      <>
                        <form action={saveImageAltAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={img.id} />
                          <label className="flex-1 min-w-32 text-sm">
                            <span className="block text-2xs text-[var(--mute)] mb-1">Alt text</span>
                            <input name="altText" defaultValue={img.altText ?? ""} placeholder="describe the image" className="w-full text-xs" />
                          </label>
                          {role === "featured" && (
                            <label className="flex items-center gap-1 text-2xs pb-1.5">
                              <input type="checkbox" name="branded" defaultChecked={img.branded} /> branded
                            </label>
                          )}
                          <SubmitButton className="btn">Save</SubmitButton>
                        </form>
                        <div className="flex flex-wrap items-center gap-2">
                          {img.status === "pending" && (
                            <form action={approveBlogImageAction}>
                              <input type="hidden" name="id" value={img.id} />
                              <SubmitButton className="btn primary" pendingText="Approving…">
                                <ShieldCheck className="w-3.5 h-3.5" /> Approve
                              </SubmitButton>
                            </form>
                          )}
                          <form action={remeasureBlogImageAction}>
                            <input type="hidden" name="id" value={img.id} />
                            <SubmitButton className="btn" pendingText="Measuring…">Re-measure</SubmitButton>
                          </form>
                          <form action={deleteBlogImageAction}>
                            <input type="hidden" name="id" value={img.id} />
                            <button className="btn" title="Remove image"><Trash2 className="w-3.5 h-3.5" /></button>
                          </form>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-[var(--mute)]">
                    Not attached.{" "}
                    {role === "og"
                      ? "The OG image is the social and search preview — it is always branded."
                      : "Sits at the top of the article."}
                  </p>
                )}

                {brief && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-[var(--mute)]">Image brief</summary>
                    <p className="mt-1 whitespace-pre-wrap">{brief}</p>
                  </details>
                )}

                {editor && (
                  <form action={attachBlogImageAction} className="flex flex-col gap-2 border-t border-[var(--line)] pt-2">
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="role" value={role} />
                    <input name="url" type="url" required placeholder="https://…/image.jpg" className="w-full font-mono text-xs" />
                    <input name="altText" placeholder="alt text" className="w-full text-xs" />
                    <div className="flex flex-wrap items-center gap-2">
                      {role === "featured" && (
                        <label className="flex items-center gap-1 text-2xs">
                          <input type="checkbox" name="branded" defaultChecked={brand.brandInBodyImages} /> branded
                        </label>
                      )}
                      <SubmitButton className="btn" pendingText="Measuring…">{img ? "Replace" : "Attach"}</SubmitButton>
                    </div>
                  </form>
                )}

                {/* E-ART-04: from the device or the Media library — cropped to the spec, the OG branded. */}
                {editor && (
                  <form action={placeBlogImageAction} encType="multipart/form-data" className="flex flex-col gap-2 border-t border-[var(--line)] pt-2" data-place-image={role}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="role" value={role} />
                    <span className="text-2xs text-[var(--mute)]">
                      Or from your device or Media — cropped to {spec.width}×{spec.height} around the subject{role === "og" || brand.brandInBodyImages ? ", with your logo lockup" : ""}.
                    </span>
                    <input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/tiff" className="text-xs" aria-label={`Upload the ${ROLE_LABELS[role].toLowerCase()}`} />
                    {mediaItems.length > 0 && (
                      <select name="mediaKey" defaultValue="" className="text-xs" aria-label="Pick from Media">
                        <option value="">…or pick one from Media</option>
                        {mediaItems.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                      </select>
                    )}
                    <input name="altText" placeholder="alt text — describe the picture" className="w-full text-xs" />
                    <div><SubmitButton className="btn" pendingText="Cropping…">Use this image</SubmitButton></div>
                  </form>
                )}

                {/* Its own form — the attach form requires a URL, which would
                    block this button's submit. */}
                {editor && brand.aiImagesEnabled && brief && (
                  <form action={generateBlogImageAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="role" value={role} />
                    <SubmitButton className="btn" pendingText="Generating…">
                      <Sparkles className="w-3.5 h-3.5" /> Generate with AI (needs review)
                    </SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-2xs text-[var(--mute)] mt-2">
          Dimensions are measured from the file itself, not typed. There is no server-side image processing here — a
          mismatch tells you exactly what to re-export or crop to.
        </p>
      </div>

      </>)}

      {is("review") && (<>
      {/* Review (FR-10): who owns it, and the conversation about it. */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold flex-1">
            Review{" "}
            <span className="font-mono text-xs text-[var(--mute)]">
              {openComments} open {openComments === 1 ? "comment" : "comments"}
            </span>
          </h2>
          {editor && (
            <form action={assignReviewerAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={post.id} />
              <select key={`reviewerId:${post.reviewerId ?? ""}`} name="reviewerId" defaultValue={post.reviewerId ?? ""} className="text-xs w-44">
                <option value="">no reviewer</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name ?? m.user.email ?? m.userId}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn">Assign</SubmitButton>
            </form>
          )}
        </div>

        {commentPolicy.block && (
          <p className="text-2xs mb-2" style={{ color: openComments ? "var(--amber-on)" : "var(--mute)" }} data-comments-hold>
            Open comments hold final approval{openComments ? ` — ${openComments} to resolve first` : ""} ·{" "}
            <Link href="/blog/brand" className="underline">Brand → Review policy</Link>
          </p>
        )}
        {post.comments.length === 0 ? (
          <p className="text-xs text-[var(--mute)] mb-2">
            No comments yet. Select words in the article below to quote them, or type the heading you mean; @name tells someone.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mb-3" data-comment-list>
            {post.comments.map((c) => {
              const present = anchorPresent(post.body, c.anchor);
              const handles = c.mentionIds.flatMap((uid) => mentionHandlesById.get(uid) ?? []);
              return (
              <li
                key={c.id}
                id={`comment-${c.id}`}
                data-comment={c.resolved ? "resolved" : "open"}
                className="text-xs border-b border-[var(--line)] pb-2 last:border-0 scroll-mt-24"
                style={c.resolved ? { opacity: 0.6 } : undefined}
              >
                {c.anchor && (
                  <p className="border-l-2 pl-2 mb-1 text-[var(--mute)]" style={{ borderColor: present ? "var(--amber)" : "var(--line)" }}>
                    {present && !c.resolved && post.body ? <a href={`#anchor-${c.id}`} className="hover:underline" title="Show this passage in the article">“{c.anchor}”</a> : <>“{c.anchor}”</>}
                    {!present && <span className="ml-1 font-mono text-micro" style={{ color: "var(--amber-on)" }} data-anchor-gone>· no longer in the article</span>}
                  </p>
                )}
                <p className="whitespace-pre-wrap">
                  {mentionSegments(c.body, handles).map((seg, i) => (seg.mention ? <b key={i} className="font-semibold" style={{ color: "var(--violet-on)" }} data-mention>{seg.text}</b> : <span key={i}>{seg.text}</span>))}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="font-mono text-micro text-[var(--mute)]">
                    {commentAuthor(c.authorId)} · {formatZonedMoment(c.createdAt, readTz)}
                    {c.resolved && c.resolvedById ? <> · resolved by {commentAuthor(c.resolvedById)}{c.resolvedAt ? ` ${formatZonedMoment(c.resolvedAt, readTz)}` : ""}</> : null}
                  </span>
                  {editor && (
                    <>
                      <form action={resolveBlogCommentAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn text-2xs">{c.resolved ? "Reopen" : "Resolve"}</button>
                      </form>
                      {(c.authorId === membership.userId || canAdmin(membership.role)) && (
                        <form action={deleteBlogCommentAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn text-2xs" title="Delete comment" aria-label="Delete comment"><Trash2 className="w-3 h-3" /></button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}

        {editor ? (
          <AnchoredCommentForm
            postId={post.id}
            html={commentHtml}
            anchors={commentMarks}
            members={mentionOptions}
          />
        ) : commentHtml ? (
          <details className="mt-2" data-comment-text>
            <summary className="cursor-pointer select-none text-xs font-semibold mb-1">The article, with the passages comments are about</summary>
            <div className="max-h-[28rem] overflow-y-auto border border-[var(--line)] rounded-lg px-3 py-2">
              <CommentableText html={commentHtml} anchors={commentMarks} />
            </div>
          </details>
        ) : null}
      </div>

      {/* Citations (truthfulness dossier) */}
      <div className="card mb-4">
        <h2 className="text-sm font-semibold mb-2">
          Citations{" "}
          <span className="font-mono text-xs text-[var(--mute)]">
            {post.citations.length - unverified}/{post.citations.length} verified
          </span>
        </h2>
        {post.citations.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            No claims to verify. AI drafts add a row here for every <span className="font-mono">[NEEDS SOURCE]</span> marker.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mb-3">
            {post.citations.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs border-b border-[var(--line)] pb-2 last:border-0">
                <span
                  className="font-mono px-1.5 py-0.5 rounded-full shrink-0"
                  style={c.verified ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--amber-soft)", color: "var(--amber-on)" }}
                >
                  {c.verified ? "verified" : "unverified"}
                </span>
                <span className="flex-1 min-w-0">
                  {c.claim}
                  {c.sourceUrl && (
                    <>
                      {" "}
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline text-[var(--blue-on)] break-all">
                        {c.sourceUrl}
                      </a>
                    </>
                  )}
                </span>
                {editor && !c.verified && (
                  <form action={verifyCitationAction} className="flex items-center gap-1 shrink-0">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="sourceUrl" placeholder="source URL" defaultValue={c.sourceUrl ?? ""} className="w-40 text-xs" />
                    <button className="btn" title="Mark verified (needs a source URL)"><Check className="w-3.5 h-3.5" /></button>
                  </form>
                )}
                {editor && (
                  <form action={deleteCitationAction} className="shrink-0">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn" title="Remove claim"><Trash2 className="w-3.5 h-3.5" /></button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editor && (
          <form action={addCitationAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <input name="claim" required placeholder="Add a claim to verify…" className="flex-1 min-w-48 text-xs" />
            <input name="sourceUrl" placeholder="source URL (optional)" className="w-48 text-xs" />
            <button className="btn">Add</button>
          </form>
        )}
      </div>

      </>)}

      {is("write") && (<>
      <form action={updateBlogPostAction} className="card flex flex-col gap-4">
        <input type="hidden" name="id" value={post.id} />
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Title</span>
          <input name="title" defaultValue={post.title} required className="w-full font-semibold" disabled={!editor} />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Focus keyword</span>
            <input name="focusKeyword" defaultValue={post.focusKeyword ?? ""} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Audience</span>
            <input name="audience" defaultValue={post.audience ?? ""} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">URL slug</span>
            <input name="slug" defaultValue={post.slug ?? ""} placeholder="my-post-slug" className="w-full font-mono" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Word-count target</span>
            <input name="wordCountTarget" type="number" min={100} defaultValue={post.wordCountTarget ?? ""} placeholder="900" className="w-full font-mono" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Secondary keywords (comma-separated)</span>
            <input name="secondaryKeywords" defaultValue={secondaryKw.join(", ")} placeholder="grant software, nonprofit tools" className="w-full text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Template</span>
            <select key={`templateKey:${post.templateKey ?? ""}`} name="templateKey" defaultValue={post.templateKey ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">none</option>
              {BLOG_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Content tier</span>
            <select key={`contentTier:${post.contentTier?.toString() ?? ""}`} name="contentTier" defaultValue={post.contentTier?.toString() ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">unset</option>
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">
              Topic {topics.length === 0 && <Link href="/ideas/topics" className="underline">add topics</Link>}
            </span>
            <select key={`topicId:${post.topicId ?? ""}`} name="topicId" defaultValue={post.topicId ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">none</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Reading level</span>
            <select key={`readingLevel:${post.readingLevel ?? ""}`} name="readingLevel" defaultValue={post.readingLevel ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">default</option>
              {["simple", "standard", "advanced"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">
              Expert <span className="font-mono">{post.smeProfileId ? "" : matchedSme ? `(auto: ${matchedSme.name})` : "(none matched)"}</span>
            </span>
            <select key={`smeProfileId:${post.smeProfileId ?? ""}`} name="smeProfileId" defaultValue={post.smeProfileId ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">the expert on this post&apos;s Topic</option>
              {experts.map((e) => <option key={e.id} value={e.id}>{e.name}{e.role ? ` — ${e.role}` : ""}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Model (this post)</span>
            <select key={`model:${post.model ?? ""}`} name="model" defaultValue={post.model ?? ""} className="w-full text-xs font-mono" disabled={!editor}>
              <option value="">workspace default ({modelLabel(inheritedModel)})</option>
              <ModelOptions choices={modelChoiceList} current={post.model} />
            </select>
            <ModelChoiceNote choices={modelChoiceList} current={post.model} runs={postModelRuns} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Meta title <span className="font-mono">({(post.metaTitle ?? "").length}/60)</span></span>
            <input name="metaTitle" defaultValue={post.metaTitle ?? ""} maxLength={60} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Meta description <span className="font-mono">({(post.metaDescription ?? "").length}/155)</span></span>
            <input name="metaDescription" defaultValue={post.metaDescription ?? ""} maxLength={155} className="w-full" disabled={!editor} />
          </label>
          {/* FR-7: canonical + OG overrides. Blank OG fields fall back to the meta pair. */}
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Canonical URL</span>
            <input name="canonicalUrl" type="url" defaultValue={post.canonicalUrl ?? ""} placeholder="leave blank to self-canonicalise" className="w-full font-mono text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">OG title <span className="font-mono">(defaults to meta title)</span></span>
            <input name="ogTitle" defaultValue={post.ogTitle ?? ""} maxLength={95} className="w-full text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">OG description <span className="font-mono">(defaults to meta description)</span></span>
            <input name="ogDescription" defaultValue={post.ogDescription ?? ""} maxLength={200} className="w-full text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">WP categories (comma-separated)</span>
            <input name="categories" defaultValue={categories.join(", ")} placeholder="connection default" className="w-full text-xs" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">WP tags (comma-separated)</span>
            <input name="tags" defaultValue={tags.join(", ")} placeholder="connection default" className="w-full text-xs" disabled={!editor} />
          </label>
        </div>

        {/* E-ART-06: how the fields above will look in Google and on cards — live as they're typed. */}
        <details className="border-t border-[var(--line)] pt-3" open data-previews-fold>
          <summary className="cursor-pointer select-none text-sm font-semibold mb-2">Search and social previews</summary>
          <SearchSocialPreview
            initial={{ title: post.title, slug: post.slug ?? "", metaTitle: post.metaTitle ?? "", metaDescription: post.metaDescription ?? "", ogTitle: post.ogTitle ?? "", ogDescription: post.ogDescription ?? "" }}
            site={previewSite}
            excerpt={previewExcerpt}
            ogImage={previewImage ? { url: previewImage.url, width: previewImage.width, height: previewImage.height, role: previewImage.role } : null}
          />
        </details>

        {/* FR-2: motif voice — single or weighted blend. Blank = inherit the
            workspace default for this tier/audience. */}
        <div>
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <span className="text-xs text-[var(--mute)]">Motif voice</span>
            <span className="text-2xs text-[var(--mute)]">
              {postMotifs.length
                ? "Highest weight is dominant — it sets structure and voice; the rest colour the intro and CTA."
                : `Inheriting: ${effectiveMotifs.length ? motifSummaryLabel(effectiveMotifs) : "no workspace default set"}`}
            </span>
            <Link href="/blog/brand" className="text-2xs text-[var(--mute)] underline ml-auto">Edit motifs</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {directives.map((d) => {
              const hue = motifHue(d.key);
              const weight = postMotifs.find((m) => m.key === d.key)?.weight;
              return (
                <label key={d.key} className="text-sm" title={d.summary}>
                  <span
                    className="block text-2xs font-mono font-semibold px-1.5 py-0.5 rounded-full mb-1 w-fit"
                    style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                  >
                    {d.label}
                  </span>
                  <input
                    name={`motif_${d.key}`}
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={weight ?? ""}
                    placeholder="0"
                    className="w-full font-mono text-xs"
                    disabled={!editor}
                  />
                </label>
              );
            })}
          </div>
          <p className="text-2xs text-[var(--mute)] mt-1">
            Weights are relative and normalised to 100% on save (up to 3 motifs). Leave every field blank to inherit.
          </p>
        </div>

        <BlogBodyEditor postId={post.id} initialBody={post.body ?? ""} serverHash={bodyHash(post.body)} disabled={!editor} extras={editorExtras} />

        {editor && (
          <div className="flex items-center gap-2">
            <SubmitButton className="btn primary">Save</SubmitButton>
          </div>
        )}
      </form>

      {/* Craft & optimize (Wave A′) */}
      {editor && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold mb-2">Craft and optimize</h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <form action={generateOutlineAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Outlining…"><Sparkles className="w-3.5 h-3.5" /> {outline.length ? "Regenerate outline" : "Generate outline"}</SubmitButton>
            </form>
            <form action={generateTitlesAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Titling…">A/B titles</SubmitButton>
            </form>
            <form action={generateMetaAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Writing meta…">Generate meta tags</SubmitButton>
            </form>
            <form action={generateAltTextAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Describing…">Fix image alt text</SubmitButton>
            </form>
          </div>

          {outline.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-[var(--mute)] mb-1">
                Outline — drafts follow it exactly. Regenerate a single section without touching the rest:
              </p>
              <ul className="text-xs flex flex-col gap-1 mb-2">
                {outline.map((s) => (
                  <li key={s.heading} className="flex items-start gap-2">
                    <form action={regenerateSectionAction} className="shrink-0">
                      <input type="hidden" name="id" value={post.id} />
                      <input type="hidden" name="heading" value={s.heading} />
                      <SubmitButton className="btn" pendingText="…" title="Rewrite just this section in the draft">↻</SubmitButton>
                    </form>
                    <span><b>{s.heading}</b>{s.points.length ? <span className="text-[var(--mute)]"> — {s.points.join("; ")}</span> : null}</span>
                  </li>
                ))}
              </ul>
              <details>
                <summary className="text-xs text-[var(--mute)] cursor-pointer">Edit outline as JSON</summary>
                <form action={saveOutlineAction} className="mt-1 flex flex-col gap-1">
                  <input type="hidden" name="id" value={post.id} />
                  <textarea name="outline" rows={5} defaultValue={JSON.stringify(outline, null, 1)} className="w-full font-mono text-micro" />
                  <button className="btn self-start">Save outline</button>
                </form>
              </details>
            </div>
          )}

          {titleVariants.length > 0 && (
            <div>
              <p className="text-xs text-[var(--mute)] mb-1">Title variants (CTR-focused):</p>
              <ul className="text-xs flex flex-col gap-1">
                {titleVariants.map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <form action={applyTitleAction} className="shrink-0">
                      <input type="hidden" name="id" value={post.id} />
                      <input type="hidden" name="title" value={t} />
                      <button className="btn">Use</button>
                    </form>
                    <span className={t === post.title ? "font-semibold" : ""}>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      </>)}

      {is("optimize") && (<>
      {/* Optimize → "Address these": findings as cards (One-Loop step 1). The
          E-E-A-T review, content gaps and entity coverage used to end in a
          paragraph of advice; they now end in Apply / Answer / Add to ideas. */}
      {post.body && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold mb-2">Address these</h2>
          <FindingCards
            postId={post.id}
            findings={findings}
            searchReal={searchInfo.real}
            canEdit={editor}
          />
        </div>
      )}

      {/* E-ART-11: each section against the target reading level, with what pulls it down. */}
      <ReadabilityCoach body={post.body} readingLevel={post.readingLevel} />

      {/* Quick additions — one-click mechanical edits that predate the cards. */}
      {editor && post.body && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold mb-2">Quick additions</h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <form action={addFaqSectionAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Writing FAQ…">Add FAQ section</SubmitButton>
            </form>
            <form action={addKeyTakeawaysAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Summarizing…">Add key takeaways</SubmitButton>
            </form>
          </div>
        </div>
      )}

      {/* E-ART-12: links in and out, offers both ways, and the AI's suggestions. */}
      <InternalLinks workspaceId={workspace.id} post={{ id: post.id, publishedUrl: post.publishedUrl, focusKeyword: post.focusKeyword, body: post.body }} editor={editor} aiSuggestions={linkSuggestions} />

      </>)}

      {is("distribute") && (<>
      {/* Video package (Phase 4) — once the post reaches approval/published */}
      {(post.status === "final_approval" || post.status === "published") && editor && (
        <div className="card mt-4 flex flex-wrap items-center gap-2 text-sm">
          <b>Video:</b>
          <span className="text-xs text-[var(--mute)] flex-1">
            Package this post into a short-form video (8s vertical) — queued on the <Link href="/videos" className="underline">Videos</Link> page.
          </span>
          <form action={createVideoPackageAction}>
            <input type="hidden" name="blogPostId" value={post.id} />
            <SubmitButton className="btn" pendingText="Packaging…">
              <Sparkles className="w-4 h-4" /> Create video package
            </SubmitButton>
          </form>
        </div>
      )}

      {/* Branded short (HeyGen HyperFrames cloud) — a title card themed from the
          workspace BrandKit. Distinct from the Veo package above. */}
      {(post.status === "final_approval" || post.status === "published") && editor && (
        <div className="card mt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
            <b>Branded short:</b>
            <span className="text-xs text-[var(--mute)] flex-1 min-w-40">
              A 6s vertical title card from this workspace&apos;s brand colours & footer.
              {brandedReadiness.mode === "local" && " Renders free on this server."}
              {brandedReadiness.mode === "cloud" && " Renders on HeyGen&apos;s cloud (pay-per-credit)."}
            </span>
            {brandedReadiness.ready ? (
              <form action={renderBrandedShortAction}>
                <input type="hidden" name="blogPostId" value={post.id} />
                <SubmitButton className="btn" pendingText="Rendering… (~1–2 min)">
                  <Sparkles className="w-4 h-4" /> Render branded short
                </SubmitButton>
              </form>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                Add a HeyGen key under <Link href="/admin/api-keys" className="underline">Settings → Keys</Link> (or run where Chrome is installed for free local rendering) to enable.
              </span>
            )}
          </div>
          {brandedShorts.length > 0 && (
            <div className="grid grid-cols-1 @lg:grid-cols-2 @3xl:grid-cols-3 gap-3 mt-3">
              {brandedShorts.map((s) => (
                <div key={s.id} className="rounded-xl border border-[var(--line)] overflow-hidden flex flex-col">
                  {s.status === "done" && (s.storedUrl || s.videoUrl) ? (
                    <video src={s.storedUrl ?? s.videoUrl!} controls preload="none" className="w-full bg-black" />
                  ) : (
                    <div className="aspect-[9/16] max-h-56 grid place-items-center text-xs" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                      {s.status === "rendering" ? "Rendering on HeyGen…" : s.error ? "Failed" : s.status}
                    </div>
                  )}
                  <div className="p-2 flex items-center gap-2">
                    <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: `var(--${s.status === "done" ? "green" : s.status === "failed" ? "rose" : "amber"}-soft)`, color: `var(--${s.status === "done" ? "green" : s.status === "failed" ? "rose" : "amber"}-on)` }}>
                      {s.status}
                    </span>
                    <span className="text-2xs text-[var(--mute)] flex-1 truncate" title={s.error ?? s.eyebrow ?? ""}>
                      {s.error ? s.error : s.eyebrow}
                    </span>
                    {s.status === "done" && (s.storedUrl || s.videoUrl) && (
                      <a href={s.storedUrl ?? s.videoUrl!} download className="text-2xs underline">Download</a>
                    )}
                    <form action={deleteBrandedShortAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-2xs text-[var(--mute)] hover:text-[var(--rose-on)]" title="Delete">✕</button>
                    </form>
                  </div>
                  {s.status === "done" && !s.storedUrl && s.videoUrl && (
                    <p className="px-2 pb-2 text-micro text-[var(--mute)]">⚠ HeyGen link only — expires; couldn&apos;t persist to storage.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Social ideas from this article (Topics as the spine, 2026-09-21): the
          engine proposes angles as IDEAS on the board, which take the gate and
          are drafted into the queue like every other post. The variants panel
          below stays for the rows that exist and for the manual button. */}
      {post.status === "published" && (
        <p className="text-xs text-[var(--mute)] mt-4 mb-0">
          {post._count.socialIdeas > 0
            ? <>{post._count.socialIdeas} social idea{post._count.socialIdeas === 1 ? "" : "s"} came from this article — <Link href="/ideas?format=social" className="underline">see them on the board</Link>; the posts they become land on the Calendar with this article&apos;s link.</>
            : <>The engine proposes this article&apos;s social angles as ideas on the <Link href="/ideas?format=social" className="underline">board</Link> on its next sweep; they are drafted into the queue with the article&apos;s link.</>}
        </p>
      )}
      {/* Social variants (FR-12) — once the post reaches approval/published */}
      {(post.status === "final_approval" || post.status === "published") && (
        <div className="card mt-4">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold flex-1">
              Social variants{" "}
              <span className="font-mono text-xs text-[var(--mute)]">
                {post.variants.filter((v) => v.status === "posted").length}/{post.variants.length} posted
              </span>
            </h2>
            {editor && (
              <form action={generateSocialVariantsAction}>
                <input type="hidden" name="postId" value={post.id} />
                <SubmitButton className="btn" pendingText="Writing…">
                  <Sparkles className="w-4 h-4" /> {post.variants.length ? "Regenerate" : "Generate"} variants
                </SubmitButton>
              </form>
            )}
          </div>
          {post.variants.length === 0 ? (
            <p className="text-xs text-[var(--mute)]">
              Generate LinkedIn / X / Instagram / Facebook copy from the article. {"{{URL}}"} becomes the published link.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {post.variants.map((v) => (
                <li key={v.id} className="border-b border-[var(--line)] pb-2 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-semibold uppercase">{v.platform}</span>
                    <span
                      className="font-mono text-micro px-1.5 py-0.5 rounded-full"
                      style={
                        v.status === "posted"
                          ? { background: "var(--green-soft)", color: "var(--green-on)" }
                          : v.status === "approved"
                            ? { background: "var(--blue-soft)", color: "var(--blue-on)" }
                            : { background: "var(--panel)", color: "var(--mute)" }
                      }
                    >
                      {v.status}
                    </span>
                    <span className="flex-1" />
                    {editor && v.status === "draft" && (
                      <form action={setSocialVariantStatusAction}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button className="btn">Approve</button>
                      </form>
                    )}
                    {editor && v.status === "approved" && (
                      <>
                        {/* Sending is an admin act, and only once the article is
                            live — before that {{URL}} has nothing to point at (ART-11). */}
                        {admin && post.status === "published" && post.publishedUrl ? (
                          <form action={postSocialVariantAction}>
                            <input type="hidden" name="id" value={v.id} />
                            <SubmitButton className="btn primary" pendingText="Posting…"><Send className="w-3.5 h-3.5" /> Post now</SubmitButton>
                          </form>
                        ) : (
                          <span className="text-micro text-[var(--mute)]">{admin ? "Post now opens once the article is live with its link" : "An admin posts it once the article is live"}</span>
                        )}
                        <form action={setSocialVariantStatusAction}>
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="status" value="posted" />
                          <button className="btn" title="Mark posted without publishing through a connected account">Mark posted</button>
                        </form>
                      </>
                    )}
                    {editor && v.status !== "posted" && (
                      <form action={deleteSocialVariantAction}>
                        <input type="hidden" name="id" value={v.id} />
                        <button className="btn" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </form>
                    )}
                  </div>
                  <p className="text-xs whitespace-pre-wrap text-[var(--slate)]">
                    {v.content.replaceAll("{{URL}}", post.publishedUrl ?? "{{URL}}")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      </>)}

      {is("write") && (<>
      {/* Version history */}
      {post.versions.length > 0 && (
        <details className="card mt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold">
            Version history <span className="font-mono text-xs text-[var(--mute)]">({post.versions.length})</span>
          </summary>
          <p className="text-xs mt-2 mb-1">
            <Link href={`/blog/${post.id}/versions`} className="underline" data-compare-link>Compare any two versions</Link>
            <span className="text-[var(--mute)]"> — side by side, with the words that changed marked.</span>
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {post.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-xs border-b border-[var(--line)] pb-1 last:border-0">
                <span className="font-mono text-[var(--mute)] shrink-0">
                  {formatZonedMoment(v.createdAt, tz)}
                </span>
                <span className="font-semibold">{v.label}</span>
                <span className="text-[var(--mute)] shrink-0" data-version-actor>· {versionActor(v, memberName, actorSince)}</span>
                <span className="text-[var(--mute)] flex-1 truncate">
                  {(v.body ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "(empty)"}
                </span>
                <Link href={`/blog/${post.id}/versions?a=${v.id}&b=current`} className="btn" title="See what changed between this version and the current text — and restore from there">Compare</Link>
                {editor && (
                  <form action={restoreBlogVersionAction}>
                    <input type="hidden" name="versionId" value={v.id} />
                    <button className="btn" title="Restore this version (current body is snapshotted first)">Restore</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editor && (
        <div className="flex items-center gap-2 mt-4">
          {post.status === "published" && post.wpPostId == null ? (
            <span className="text-xs text-[var(--mute)]">
              Published outside the app — regenerating can&apos;t replace the live page, so it&apos;s off here. Edit by hand, or start a new article.
            </span>
          ) : (
            <>
              <form action={generateBlogDraftAction}>
                <input type="hidden" name="id" value={post.id} />
                <SubmitButton className="btn">
                  <Sparkles className="w-4 h-4" /> {post.status === "published" ? "Revise the live article" : post.body ? "Regenerate draft" : "Generate draft"}
                </SubmitButton>
              </form>
              <span className="text-xs text-[var(--mute)]">
                {post.status === "published"
                  ? "Rewrites from the live text; it goes back through review, and the live page stays as it is until the revision publishes in place."
                  : post.status === "final_approval"
                    ? "Overwrites the body and sends it back through review — its publish date doesn't carry over."
                    : "Grounded in your channel voice + audience. Overwrites the body — save your edits first."}
              </span>
            </>
          )}
          <span className="flex-1" />
          {admin && (
            <form action={deleteBlogPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button className="btn" title="Delete post"><Trash2 className="w-4 h-4" /> Delete</button>
            </form>
          )}
        </div>
      )}
      </>)}

      </div>

      {/* Gates sidebar — the publish contract, visible from every tab. */}
      <aside className="hidden @4xl:block sticky top-14">
        <div className="card !p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4" style={{ color: gatesPass ? "var(--green-on)" : "var(--amber-on)" }} />
            <span className="text-2xs font-mono font-bold uppercase tracking-wider text-[var(--mute)]">Gates</span>
            <span className="flex-1" />
            <span className="font-mono text-micro font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
              score {score.total}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {checks.filter((c) => c.required).map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-2xs leading-snug">
                {c.pass ? (
                  <Check className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
                ) : (
                  <X className="w-3 h-3 mt-0.5 shrink-0" style={{ color: "var(--rose-on)" }} />
                )}
                <span style={c.pass ? { color: "var(--mute)" } : undefined}>{c.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t border-[var(--line)] text-2xs">
            {overridden ? (
              <span style={{ color: "var(--amber-on)" }} className="font-semibold">
                {failingCount} failing — overridden by an admin for this text, so it advances and publishes anyway.
              </span>
            ) : gatesPass ? (
              <span style={{ color: "var(--green-on)" }} className="font-semibold">All gates pass — ready to advance.</span>
            ) : (
              <Link href={`/blog/${post.id}?tab=review`} className="underline" style={{ color: "var(--amber-on)" }}>
                {checks.filter((c) => c.required && !c.pass).length} blocking — details in Review
              </Link>
            )}
          </div>
        </div>
      </aside>

      </div>
    </main>
  );
}
