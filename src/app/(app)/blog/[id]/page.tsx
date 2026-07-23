import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
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
import {
  applySlugConventionAction,
  generatePublisherNotesAction,
  suggestExternalLinkAction,
} from "@/app/actions/blog-publish-prep";
import {
  approveBlogImageAction,
  attachBlogImageAction,
  deleteBlogImageAction,
  generateBlogImageAction,
  generateImageBriefsAction,
  remeasureBlogImageAction,
  saveImageAltAction,
} from "@/app/actions/blog-images";
import { llm } from "@/lib/llm";
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
  applyInternalLinkAction,
  contentGapAction,
  eeatReviewAction,
  entityCoverageAction,
  suggestInternalLinksAction,
} from "@/app/actions/blog-optimize";
import { SubmitButton } from "@/components/SubmitButton";
import { BlogBodyEditor } from "@/components/BlogBodyEditor";
import {
  addCitationAction,
  advanceBlogStatusAction,
  deleteBlogPostAction,
  deleteCitationAction,
  generateBlogDraftAction,
  restoreBlogVersionAction,
  scheduleBlogPostAction,
  updateBlogPostAction,
  verifyCitationAction,
} from "@/app/actions/blog";
import { publishToWordPressAction } from "@/app/actions/blog-wp";
import {
  deleteSocialVariantAction,
  generateSocialVariantsAction,
  setSocialVariantStatusAction,
} from "@/app/actions/blog-social";
import { createVideoPackageAction } from "@/app/actions/videos";

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

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      citations: { orderBy: { createdAt: "asc" } },
      images: true,
      variants: { orderBy: { platform: "asc" } },
      versions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!post) notFound();
  const wpConn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });

  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const idx = FLOW.indexOf(post.status as (typeof FLOW)[number]);
  const nextIsPublish = FLOW[idx + 1] === "published";
  const unverified = post.citations.filter((c) => !c.verified).length;
  // FR-8: the asset gate rides in the same checks list the publish flow uses.
  const [assets, brand, briefs] = await Promise.all([
    loadAssetGate(workspace.id, post.id),
    getBrandKit(workspace.id),
    getImageBriefs(post.id),
  ]);
  const checks = runBlogChecks(post, unverified, assets);
  const gatesPass = requiredChecksPass(checks);
  const score = contentScore(post, checks);
  const [titlesSetting, linksSetting, gapsSetting] = await Promise.all([
    db.setting.findUnique({ where: { key: `blog:titles:${post.id}` } }),
    db.setting.findUnique({ where: { key: `blog:links:${post.id}` } }),
    db.setting.findUnique({ where: { key: `blog:gaps:${post.id}` } }),
  ]);
  let titleVariants: string[] = [];
  try { titleVariants = titlesSetting ? (JSON.parse(titlesSetting.value) as string[]) : []; } catch { titleVariants = []; }
  let linkSuggestions: Array<{ url: string; anchorText: string }> = [];
  try { linkSuggestions = linksSetting ? JSON.parse(linksSetting.value) : []; } catch { linkSuggestions = []; }
  let gaps: { needsKey?: boolean; missing?: Array<{ subtopic: string; why: string }> } | null = null;
  try { gaps = gapsSetting ? JSON.parse(gapsSetting.value) : null; } catch { gaps = null; }
  const entitiesSetting = await db.setting.findUnique({ where: { key: `blog:entities:${post.id}` } });
  let entities: { covered?: string[]; missing?: string[] } | null = null;
  try { entities = entitiesSetting ? JSON.parse(entitiesSetting.value) : null; } catch { entities = null; }
  let eeat: { summary?: string; findings?: Array<{ dimension: string; finding: string; suggestion: string }> } | null = null;
  try { eeat = post.eeatReview ? JSON.parse(post.eeatReview) : null; } catch { eeat = null; }
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
    seo: Array<{ key: string; accepted: boolean; stored: string | null }>;
    seoUnverified: boolean;
    featuredUploadFailed: boolean;
    categories: { missed: string[] };
    tags: { missed: string[] };
  } | null = null;
  try {
    publishReport = post.publishReport ? JSON.parse(post.publishReport) : null;
  } catch {
    publishReport = null;
  }
  const categories = parseCsvJson(post.categories);
  const tags = parseCsvJson(post.tags);
  const postMotifs = parseMotifs(post.motifs);
  const [directives, effectiveMotifs] = await Promise.all([
    ensureMotifDirectives(workspace.id),
    resolveMotifs(workspace.id, post),
  ]);

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All posts
      </Link>

      {/* State rail */}
      <div className="card mb-4 flex flex-wrap items-center gap-2">
        {FLOW.map((s, i) => (
          <span
            key={s}
            className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full"
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
        {editor && idx < FLOW.length - 1 && (!nextIsPublish || admin) && (
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

      {/* Scheduled publishing — setting a time at final approval IS the human
          approval; autopilot (assisted or auto) publishes when due. */}
      {post.status === "final_approval" && admin && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 text-sm">
          <b>Schedule:</b>
          {post.scheduledAt ? (
            <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
              publishes {post.scheduledAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
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
              defaultValue={post.scheduledAt ? new Date(post.scheduledAt.getTime() - post.scheduledAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
              className="text-xs font-mono"
            />
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
            <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="underline text-[var(--blue-on)] break-all">
              {post.publishedUrl}
            </a>
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
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--mute)]">
              No site connected — <Link href="/blog/settings" className="underline">connect WordPress</Link> to publish directly.
            </span>
          )}
        </div>
      )}

      {/* Pre-publish checks (Spark gates — server-enforced on advance) */}
      <details className="card mb-4" open={!gatesPass}>
        <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
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
            title={score.parts.map((p) => `${p.label} ${p.score}/${p.max}${p.detail ? ` (${p.detail})` : ""}`).join(" · ")}
          >
            content score {score.total}/100
          </span>
          {!gatesPass && <span className="text-xs font-normal text-[var(--mute)]">— advancing to approval/publish is blocked</span>}
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
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
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                slug is off-convention
              </span>
            )}
          </div>

          {externalLinks.results.length > 0 && (
            <div className="mb-3">
              <h3 className="text-xs font-semibold mb-1">
                External source candidates{" "}
                {!externalLinks.real && (
                  <span className="font-mono text-[10px] text-[var(--mute)]">mock results — add a search key</span>
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
              <p className="text-[11px] text-[var(--mute)] mt-1">
                Suggestions only — a link is an editorial endorsement, so place it yourself.
              </p>
            </div>
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
                <span className="font-mono text-[10px] text-[var(--mute)]">
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
                {publishReport.featuredUploadFailed && (
                  <li style={{ color: "var(--rose-on)" }}>Featured image upload to the media library failed.</li>
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

      {/* Images (FR-8): featured + branded OG, at the workspace's dimensions. */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold flex-1">
            Images{" "}
            <span className="font-mono text-xs text-[var(--mute)]">
              {post.images.filter((i) => i.status === "approved").length}/2 ready
            </span>
          </h2>
          {!brand.requireImagesToPublish && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
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
                  <span className="font-mono text-[10px] text-[var(--mute)]">{spec.width}×{spec.height}</span>
                </div>

                {img ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.altText ?? ""} className="w-full rounded-lg border border-[var(--line)] object-cover max-h-40" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>
                        {verdict?.detail}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                        {img.source}
                      </span>
                      {img.status === "pending" && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                          awaiting review
                        </span>
                      )}
                      {img.branded && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
                          branded
                        </span>
                      )}
                    </div>
                    {editor && (
                      <>
                        <form action={saveImageAltAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={img.id} />
                          <label className="flex-1 min-w-32 text-sm">
                            <span className="block text-[11px] text-[var(--mute)] mb-1">Alt text</span>
                            <input name="altText" defaultValue={img.altText ?? ""} placeholder="describe the image" className="w-full text-xs" />
                          </label>
                          {role === "featured" && (
                            <label className="flex items-center gap-1 text-[11px] pb-1.5">
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
                        <label className="flex items-center gap-1 text-[11px]">
                          <input type="checkbox" name="branded" defaultChecked={brand.brandInBodyImages} /> branded
                        </label>
                      )}
                      <SubmitButton className="btn" pendingText="Measuring…">{img ? "Replace" : "Attach"}</SubmitButton>
                    </div>
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
        <p className="text-[11px] text-[var(--mute)] mt-2">
          Dimensions are measured from the file itself, not typed. There is no server-side image processing here — a
          mismatch tells you exactly what to re-export or crop to.
        </p>
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
            <select name="templateKey" defaultValue={post.templateKey ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">none</option>
              {BLOG_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Content tier</span>
            <select name="contentTier" defaultValue={post.contentTier?.toString() ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">unset</option>
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Reading level</span>
            <select name="readingLevel" defaultValue={post.readingLevel ?? ""} className="w-full text-xs" disabled={!editor}>
              <option value="">default</option>
              {["simple", "standard", "advanced"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Model (this post)</span>
            <select name="model" defaultValue={post.model ?? ""} className="w-full text-xs font-mono" disabled={!editor}>
              <option value="">workspace default</option>
              {llm.models.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}
            </select>
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

        {/* FR-2: motif voice — single or weighted blend. Blank = inherit the
            workspace default for this tier/audience. */}
        <div>
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <span className="text-xs text-[var(--mute)]">Motif voice</span>
            <span className="text-[11px] text-[var(--mute)]">
              {postMotifs.length
                ? "Highest weight is dominant — it sets structure and voice; the rest colour the intro and CTA."
                : `Inheriting: ${effectiveMotifs.length ? motifSummaryLabel(effectiveMotifs) : "no workspace default set"}`}
            </span>
            <Link href="/blog/brand" className="text-[11px] text-[var(--mute)] underline ml-auto">Edit motifs</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {directives.map((d) => {
              const hue = motifHue(d.key);
              const weight = postMotifs.find((m) => m.key === d.key)?.weight;
              return (
                <label key={d.key} className="text-sm" title={d.summary}>
                  <span
                    className="block text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-full mb-1 w-fit"
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
          <p className="text-[11px] text-[var(--mute)] mt-1">
            Weights are relative and normalised to 100% on save (up to 3 motifs). Leave every field blank to inherit.
          </p>
        </div>

        <BlogBodyEditor postId={post.id} initialBody={post.body ?? ""} disabled={!editor} />

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
                  <textarea name="outline" rows={5} defaultValue={JSON.stringify(outline, null, 1)} className="w-full font-mono text-[10px]" />
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

      {/* Optimize (Wave B′): E-E-A-T, snippet blocks, internal links, gaps */}
      {editor && post.body && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold mb-2">Optimize</h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <form action={eeatReviewAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Reviewing…">E-E-A-T review</SubmitButton>
            </form>
            <form action={addFaqSectionAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Writing FAQ…">Add FAQ section</SubmitButton>
            </form>
            <form action={addKeyTakeawaysAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Summarizing…">Add key takeaways</SubmitButton>
            </form>
            <form action={suggestInternalLinksAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Matching…">Suggest internal links</SubmitButton>
            </form>
            <form action={contentGapAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Analyzing…">Content gaps</SubmitButton>
            </form>
            <form action={entityCoverageAction}>
              <input type="hidden" name="id" value={post.id} />
              <SubmitButton className="btn" pendingText="Mapping…">Entity coverage</SubmitButton>
            </form>
          </div>

          {eeat && (
            <details className="mb-2" open>
              <summary className="text-xs font-semibold cursor-pointer">E-E-A-T findings ({eeat.findings?.length ?? 0})</summary>
              {eeat.summary && <p className="text-xs text-[var(--slate)] my-1">{eeat.summary}</p>}
              <ul className="text-xs flex flex-col gap-1">
                {(eeat.findings ?? []).map((f, i) => (
                  <li key={i}>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full mr-1" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
                      {f.dimension}
                    </span>
                    {f.finding} <span className="text-[var(--mute)]">→ {f.suggestion}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {linkSuggestions.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold mb-1">Internal link suggestions:</p>
              <ul className="text-xs flex flex-col gap-1">
                {linkSuggestions.map((l) => (
                  <li key={l.url} className="flex items-center gap-2">
                    <form action={applyInternalLinkAction} className="shrink-0">
                      <input type="hidden" name="id" value={post.id} />
                      <input type="hidden" name="url" value={l.url} />
                      <input type="hidden" name="anchorText" value={l.anchorText} />
                      <button className="btn" title="Link the first free occurrence of the anchor text">Link it</button>
                    </form>
                    <span>&ldquo;{l.anchorText}&rdquo; → <span className="font-mono text-[10px] break-all">{l.url}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps?.needsKey && (
            <p className="text-xs text-[var(--mute)]">
              Content-gap analysis needs real search data. Add a Tavily or Serper key under <Link href="/admin/api-keys" className="underline">Admin → API keys</Link> — it takes effect within ~30 seconds, then run this again.
            </p>
          )}
          {entities && (
            <div className="mb-2">
              <p className="text-xs font-semibold mb-1">Entity coverage <span className="font-normal text-[var(--mute)]">(AI-derived)</span>:</p>
              <div className="flex flex-wrap gap-1">
                {(entities.covered ?? []).map((e) => (
                  <span key={e} className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>✓ {e}</span>
                ))}
                {(entities.missing ?? []).map((e) => (
                  <span key={e} className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>+ {e}</span>
                ))}
              </div>
            </div>
          )}

          {gaps?.missing && gaps.missing.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Subtopics competitors cover that this post doesn&apos;t:</p>
              <ul className="text-xs list-disc pl-4 flex flex-col gap-0.5">
                {gaps.missing.map((g) => (
                  <li key={g.subtopic}><b>{g.subtopic}</b> <span className="text-[var(--mute)]">— {g.why}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
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
                      <form action={setSocialVariantStatusAction}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="status" value="posted" />
                        <button className="btn primary">Mark posted</button>
                      </form>
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

      {/* Version history */}
      {post.versions.length > 0 && (
        <details className="card mt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold">
            Version history <span className="font-mono text-xs text-[var(--mute)]">({post.versions.length})</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {post.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-xs border-b border-[var(--line)] pb-1 last:border-0">
                <span className="font-mono text-[var(--mute)] shrink-0">
                  {v.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-semibold">{v.label}</span>
                <span className="text-[var(--mute)] flex-1 truncate">
                  {(v.body ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "(empty)"}
                </span>
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
          <form action={generateBlogDraftAction}>
            <input type="hidden" name="id" value={post.id} />
            <SubmitButton className="btn">
              <Sparkles className="w-4 h-4" /> {post.body ? "Regenerate draft" : "Generate draft"}
            </SubmitButton>
          </form>
          <span className="text-xs text-[var(--mute)]">
            Grounded in your channel voice + audience. Overwrites the body — save your edits first.
          </span>
          <span className="flex-1" />
          {admin && (
            <form action={deleteBlogPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button className="btn" title="Delete post"><Trash2 className="w-4 h-4" /> Delete</button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
