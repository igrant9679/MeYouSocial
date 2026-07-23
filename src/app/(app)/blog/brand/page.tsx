import Link from "next/link";
import { ArrowLeft, Palette, RotateCcw } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteMotifDefaultAction,
  resetMotifDirectiveAction,
  restoreMotifDirectiveAction,
  saveBrandKitAction,
  saveHeadingSpecAction,
  saveMotifDefaultAction,
  saveMotifDirectiveAction,
  setPlatformMotifAction,
} from "@/app/actions/brand";
import {
  HEADING_LEVELS,
  MOTIF_PLATFORMS,
  PLATFORM_LABELS,
  ensureMotifDirectives,
  getBrandKit,
  getPlatformMotifs,
  motifHue,
  motifSummaryLabel,
  parseMotifs,
} from "@/lib/motifs";

// FR-2 — Brand, typography & the 7 Motifs tone engine. Everything on this page
// steers generation: the directives are the actual prompt text, not decoration.

export default async function BrandPage() {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const [brand, directives, defaults, platformMap] = await Promise.all([
    getBrandKit(workspace.id),
    ensureMotifDirectives(workspace.id),
    db.motifDefault.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ tier: "asc" }, { createdAt: "asc" }] }),
    getPlatformMotifs(workspace.id),
  ]);
  const history = await db.motifDirectiveVersion.findMany({
    where: { directiveId: { in: directives.map((d) => d.id) } },
    orderBy: { version: "desc" },
    take: 60,
  });

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Palette className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Brand &amp; motifs</h1>
          <p className="text-xs text-[var(--mute)]">
            Brand kit, article typography, and the 7 Motifs tone engine that shapes every generation in this workspace.
          </p>
        </div>
      </div>

      {!admin && (
        <div className="card mb-4">
          <p className="text-xs text-[var(--mute)]">These settings are read-only for your role — an admin can change them.</p>
        </div>
      )}

      {/* ---- Brand kit ---- */}
      <form action={saveBrandKitAction} className="card flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Brand kit</h2>
          <p className="text-xs text-[var(--mute)]">
            This workspace&apos;s own brand — used for published output and image briefs, not for the app&apos;s own theme.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Primary colour</span>
            <input name="primaryColor" defaultValue={brand.primaryColor ?? ""} placeholder="#0D5A84" className="w-full font-mono text-xs" disabled={!admin} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Secondary colour</span>
            <input name="secondaryColor" defaultValue={brand.secondaryColor ?? ""} placeholder="#343433" className="w-full font-mono text-xs" disabled={!admin} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Accent colour</span>
            <input name="accentColor" defaultValue={brand.accentColor ?? ""} placeholder="#E5482F" className="w-full font-mono text-xs" disabled={!admin} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Heading font</span>
            <input name="headingFont" defaultValue={brand.headingFont ?? ""} placeholder="Quicksand" className="w-full text-xs" disabled={!admin} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Body font</span>
            <input name="bodyFont" defaultValue={brand.bodyFont ?? ""} placeholder="Kollektif" className="w-full text-xs" disabled={!admin} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Logo URL</span>
            <input name="logoUrl" type="url" defaultValue={brand.logoUrl ?? ""} placeholder="https://…/logo.svg" className="w-full font-mono text-xs" disabled={!admin} />
          </label>
        </div>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Footer credit</span>
          <input name="footerCredit" defaultValue={brand.footerCredit ?? ""} placeholder="© LSI Media — all rights reserved" className="w-full text-xs" disabled={!admin} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">
            Tone guardrails <span className="font-mono">(hard rules injected into every generation)</span>
          </span>
          <textarea
            name="toneGuardrails"
            defaultValue={brand.toneGuardrails ?? ""}
            rows={3}
            placeholder={"Never use \"leverage\" as a verb. British spelling. Never promise ranking positions."}
            className="w-full text-xs"
            disabled={!admin}
          />
        </label>

        <div>
          <h3 className="text-xs font-semibold mb-1">Image dimensions</h3>
          <p className="text-xs text-[var(--mute)] mb-2">Editable per workspace — the asset gate checks uploads against these.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">Featured width</span>
              <input name="featuredImageWidth" type="number" min={200} max={6000} defaultValue={brand.featuredImageWidth} className="w-full font-mono text-xs" disabled={!admin} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">Featured height</span>
              <input name="featuredImageHeight" type="number" min={200} max={6000} defaultValue={brand.featuredImageHeight} className="w-full font-mono text-xs" disabled={!admin} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">OG width</span>
              <input name="ogImageWidth" type="number" min={200} max={6000} defaultValue={brand.ogImageWidth} className="w-full font-mono text-xs" disabled={!admin} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">OG height</span>
              <input name="ogImageHeight" type="number" min={200} max={6000} defaultValue={brand.ogImageHeight} className="w-full font-mono text-xs" disabled={!admin} />
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold mb-1">Asset policy</h3>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" name="requireImagesToPublish" defaultChecked={brand.requireImagesToPublish} disabled={!admin} className="mt-0.5" />
              <span>
                <b>Block publishing without both images.</b> A featured image and a branded OG image must exist at the
                dimensions above, each with alt text. Turning this off makes the image checks advisory.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" name="aiImagesEnabled" defaultChecked={brand.aiImagesEnabled} disabled={!admin} className="mt-0.5" />
              <span>
                <b>Allow AI image generation.</b> Generated images always land awaiting human review — they never
                satisfy the publish gate on their own.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" name="brandInBodyImages" defaultChecked={brand.brandInBodyImages} disabled={!admin} className="mt-0.5" />
              <span>
                <b>Brand the featured and in-body images too.</b> The OG image is always branded regardless.
              </span>
            </label>
          </div>
        </div>
        {admin && <div><SubmitButton className="btn primary">Save brand kit</SubmitButton></div>}
      </form>

      {/* ---- Heading spec ---- */}
      <form action={saveHeadingSpecAction} className="card mt-5 flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">Article heading spec</h2>
          <p className="text-xs text-[var(--mute)]">
            Article-scoped H1–H6 sizes in pixels with top/bottom margins — set independently of the site theme&apos;s
            (usually oversized) hero headings. Semantic heading order is always preserved regardless of these sizes.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--mute)]">
                <th className="pb-1 pr-2 font-medium">Level</th>
                <th className="pb-1 pr-2 font-medium">Size (px)</th>
                <th className="pb-1 pr-2 font-medium">Margin top</th>
                <th className="pb-1 pr-2 font-medium">Margin bottom</th>
                <th className="pb-1 pr-2 font-medium">Weight</th>
                <th className="pb-1 pr-2 font-medium">Line height</th>
                <th className="pb-1 font-medium">Colour</th>
              </tr>
            </thead>
            <tbody>
              {HEADING_LEVELS.map((level) => {
                const s = brand.headingSpec[level];
                return (
                  <tr key={level} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-2 font-mono font-semibold uppercase">{level}</td>
                    <td className="py-1.5 pr-2">
                      <input name={`${level}_px`} type="number" min={8} max={120} defaultValue={s.px} className="w-16 font-mono text-xs" disabled={!admin} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input name={`${level}_marginTop`} type="number" min={0} max={200} defaultValue={s.marginTop} className="w-16 font-mono text-xs" disabled={!admin} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input name={`${level}_marginBottom`} type="number" min={0} max={200} defaultValue={s.marginBottom} className="w-16 font-mono text-xs" disabled={!admin} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input name={`${level}_weight`} type="number" min={100} max={900} step={100} defaultValue={s.weight ?? 600} className="w-16 font-mono text-xs" disabled={!admin} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input name={`${level}_lineHeight`} type="number" min={1} max={3} step={0.05} defaultValue={s.lineHeight ?? 1.3} className="w-16 font-mono text-xs" disabled={!admin} />
                    </td>
                    <td className="py-1.5">
                      <input name={`${level}_color`} defaultValue={s.color ?? ""} placeholder="inherit" className="w-24 font-mono text-xs" disabled={!admin} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {admin && <div><SubmitButton className="btn primary">Save heading spec</SubmitButton></div>}
      </form>

      {/* ---- The 7 Motifs ---- */}
      <div className="card mt-5">
        <h2 className="text-sm font-semibold">The 7 Motifs</h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          Each motif is an editable style directive injected into generation prompts — voice, rhythm, evidence and CTA
          pattern. Every edit keeps the previous text as a version you can restore.
        </p>
        <div className="flex flex-col gap-3">
          {directives.map((d, i) => {
            const hue = motifHue(d.key);
            const versions = history.filter((h) => h.directiveId === d.id).slice(0, 5);
            return (
              <details key={d.id} className="rounded-xl border border-[var(--line)] overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-[var(--mute)]">{String(i + 1).padStart(2, "0")}</span>
                  <span
                    className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}
                  >
                    {d.label}
                  </span>
                  <span className="text-xs text-[var(--mute)] flex-1 min-w-32 truncate">{d.summary}</span>
                  <span className="font-mono text-[10px] text-[var(--mute)]">v{d.version}</span>
                </summary>
                <div className="px-3 pb-3 pt-1 border-t border-[var(--line)]">
                  <form action={saveMotifDirectiveAction} className="flex flex-col gap-2">
                    <input type="hidden" name="key" value={d.key} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="text-sm">
                        <span className="block text-xs text-[var(--mute)] mb-1">Label</span>
                        <input name="label" defaultValue={d.label} className="w-full text-xs" disabled={!admin} />
                      </label>
                      <label className="text-sm">
                        <span className="block text-xs text-[var(--mute)] mb-1">Summary</span>
                        <input name="summary" defaultValue={d.summary} className="w-full text-xs" disabled={!admin} />
                      </label>
                    </div>
                    <label className="text-sm">
                      <span className="block text-xs text-[var(--mute)] mb-1">Voice signature</span>
                      <textarea name="voice" defaultValue={d.voice} rows={2} className="w-full text-xs" disabled={!admin} />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-[var(--mute)] mb-1">Sentence rhythm &amp; structure</span>
                      <textarea name="rhythm" defaultValue={d.rhythm} rows={2} className="w-full text-xs" disabled={!admin} />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-[var(--mute)] mb-1">Evidence type</span>
                      <textarea name="evidence" defaultValue={d.evidence} rows={2} className="w-full text-xs" disabled={!admin} />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-[var(--mute)] mb-1">CTA pattern</span>
                      <input name="cta" defaultValue={d.cta} className="w-full text-xs" disabled={!admin} />
                    </label>
                    {admin && (
                      <div className="flex flex-wrap items-center gap-2">
                        <SubmitButton className="btn primary">Save directive</SubmitButton>
                      </div>
                    )}
                  </form>
                  {admin && (
                    <form action={resetMotifDirectiveAction} className="mt-2">
                      <input type="hidden" name="key" value={d.key} />
                      <SubmitButton className="btn" pendingText="Resetting…">
                        <RotateCcw className="w-3.5 h-3.5" /> Reset to framework default
                      </SubmitButton>
                    </form>
                  )}
                  {versions.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold mb-1">Version history</h4>
                      <ul className="text-xs flex flex-col gap-1">
                        {versions.map((v) => (
                          <li key={v.id} className="flex items-center gap-2 border-b border-[var(--line)] pb-1 last:border-0">
                            <span className="font-mono text-[10px] text-[var(--mute)]">v{v.version}</span>
                            <span className="flex-1 truncate">{v.label}</span>
                            <span className="font-mono text-[10px] text-[var(--mute)]">
                              {v.createdAt.toISOString().slice(0, 10)}
                            </span>
                            {admin && (
                              <form action={restoreMotifDirectiveAction}>
                                <input type="hidden" name="versionId" value={v.id} />
                                <button className="btn">Restore</button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {/* ---- Workspace defaults ---- */}
      <div className="card mt-5">
        <h2 className="text-sm font-semibold">Motif defaults</h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          The blend a new post starts from when its author hasn&apos;t chosen one. The most specific rule wins:
          tier + audience beats tier, which beats audience, which beats the catch-all.
        </p>
        {defaults.length === 0 ? (
          <p className="text-xs text-[var(--mute)] mb-3">No defaults yet — posts without a motif selection generate without a motif block.</p>
        ) : (
          <ul className="text-xs flex flex-col gap-1 mb-3">
            {defaults.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-1 last:border-0">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                  {row.tier ? `Tier ${row.tier}` : "any tier"}
                </span>
                <span className="text-[var(--mute)]">{row.audience || "any audience"}</span>
                <span className="flex-1 min-w-32">{motifSummaryLabel(parseMotifs(row.motifs))}</span>
                {admin && (
                  <form action={deleteMotifDefaultAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="btn">✕</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <form action={saveMotifDefaultAction} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-xs text-[var(--mute)] mb-1">Content tier</span>
                <select name="tier" className="text-xs w-28" defaultValue="">
                  <option value="">any</option>
                  {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
                </select>
              </label>
              <label className="text-sm flex-1 min-w-40">
                <span className="block text-xs text-[var(--mute)] mb-1">Audience contains</span>
                <input name="audience" placeholder="e.g. nonprofit" className="w-full text-xs" />
              </label>
            </div>
            <MotifWeightFields options={directives.map((d) => ({ key: d.key, label: d.label }))} />
            <div><SubmitButton className="btn primary">Add default</SubmitButton></div>
          </form>
        )}
      </div>

      {/* ---- Per-channel mapping ---- */}
      <div className="card mt-5 mb-8">
        <h2 className="text-sm font-semibold">Per-channel motif mapping</h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          An article can be Informative while its LinkedIn variant leans Social. Unmapped channels inherit the
          article&apos;s own blend.
        </p>
        <ul className="flex flex-col gap-2">
          {MOTIF_PLATFORMS.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="text-xs w-36 shrink-0">{PLATFORM_LABELS[p]}</span>
              <form action={setPlatformMotifAction} className="flex items-center gap-2">
                <input type="hidden" name="platform" value={p} />
                <select name="motifKey" defaultValue={platformMap[p] ?? ""} className="text-xs w-40" disabled={!admin}>
                  <option value="">inherit from article</option>
                  {directives.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                {admin && <SubmitButton className="btn">Set</SubmitButton>}
              </form>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/** Weight inputs for the 7 motifs — same field names as the post editor's picker. */
function MotifWeightFields({ options }: { options: Array<{ key: string; label: string }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {options.map((m) => (
        <label key={m.key} className="text-sm">
          <span
            className="block text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-full mb-1 w-fit"
            style={{ background: `var(--${motifHue(m.key)}-soft)`, color: `var(--${motifHue(m.key)}-on)` }}
          >
            {m.label}
          </span>
          <input name={`motif_${m.key}`} type="number" min={0} max={100} placeholder="0" className="w-full font-mono text-xs" />
        </label>
      ))}
    </div>
  );
}
