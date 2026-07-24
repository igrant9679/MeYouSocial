import Link from "next/link";
import {
  Palette, Building2, Users, Tags, Hash, Share2, Check, X, Archive, Trash2,
  ExternalLink, Sparkles,
} from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { readJson } from "@/lib/db/json";
import { SubmitButton } from "@/components/SubmitButton";
import { saveOrgProfileAction } from "@/app/actions/blog";
import {
  saveBrandIdentityAction,
  createTopicAction,
  updateTopicAction,
  toggleTopicStatusAction,
  deleteTopicAction,
} from "@/app/actions/brand-hub";
import { networkFor } from "@/lib/social/networks";

// Brand — the workspace's identity in one place: colours, company info,
// personas, topics, keywords and connected social accounts. Everything here is
// per-workspace, so each company on this install has its own.
// Rich editors that already exist (personas, keywords, motifs, app chrome)
// are linked rather than duplicated.

type SP = { ok?: string; err?: string };

export default async function BrandPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);

  const [kit, org, personas, topics, keywordCount, clusters, socials] = await Promise.all([
    db.brandKit.findUnique({ where: { workspaceId: workspace.id } }),
    db.orgProfile.findUnique({ where: { workspaceId: workspace.id } }),
    db.smeProfile.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { createdAt: "asc" }, take: 12 }),
    db.topic.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    db.keyword.count({ where: { workspaceId: workspace.id } }),
    db.keyword.findMany({ where: { workspaceId: workspace.id, cluster: { not: null } }, select: { cluster: true }, take: 200 }),
    db.unipileAccount.findMany({ where: { workspaceId: workspace.id, kind: "social" }, orderBy: { createdAt: "asc" } }),
  ]);

  const clusterNames = [...new Set(clusters.map((c) => c.cluster).filter(Boolean) as string[])].slice(0, 8);
  const logoUrl = workspace.logoKey ? storage.url(workspace.logoKey) : null;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--pink-soft)", color: "var(--pink-on)" }}>
          <Palette className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Brand</h1>
          <p className="text-xs text-[var(--mute)]">
            Everything that makes <b>{workspace.name}</b> sound and look like itself. All of it is scoped to this
            workspace — other companies on this install have their own.
          </p>
        </div>
      </div>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* ── Brand identity: colours + fonts ─────────────────────────────── */}
      <SectionHead icon={<Palette className="w-4 h-4" style={{ color: "var(--pink-on)" }} />} title="Brand identity"
        note="Colours and fonts used in generated content — blog images, OG cards and published output." />
      <form action={saveBrandIdentityAction} className="card mb-6 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ColorField name="primaryColor" label="Primary" value={kit?.primaryColor ?? ""} disabled={!admin} />
          <ColorField name="secondaryColor" label="Secondary" value={kit?.secondaryColor ?? ""} disabled={!admin} />
          <ColorField name="accentColor" label="Accent" value={kit?.accentColor ?? ""} disabled={!admin} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field name="headingFont" label="Heading font" value={kit?.headingFont ?? ""} placeholder="e.g. IBM Plex Sans" disabled={!admin} />
          <Field name="bodyFont" label="Body font" value={kit?.bodyFont ?? ""} placeholder="e.g. Inter" disabled={!admin} />
          <Field name="logoUrl" label="Logo URL (for generated content)" value={kit?.logoUrl ?? ""} placeholder="https://…" disabled={!admin} />
          <Field name="footerCredit" label="Footer credit" value={kit?.footerCredit ?? ""} placeholder="© Your Company" disabled={!admin} />
        </div>
        {admin ? (
          <div className="flex items-center gap-3">
            <SubmitButton className="btn primary self-start">Save brand identity</SubmitButton>
            <span className="text-[11px] text-[var(--mute)]">
              Image sizes, tone guardrails and asset policy live in <Link href="/blog/brand" className="underline">Blog → Brand</Link>.
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--mute)]">Admins can edit brand identity.</p>
        )}
      </form>

      {/* ── App appearance (chrome) ─────────────────────────────────────── */}
      <SectionHead icon={<Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} />} title="App appearance"
        note="The accent colour and logo of the app itself, for everyone in this workspace." />
      <div className="card mb-6 flex items-center gap-3 flex-wrap">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="w-9 h-9 rounded-xl object-cover border border-[var(--line)]" />
        ) : (
          <span className="text-[11px] font-mono text-[var(--mute)]">default logo</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs font-mono">
          <span className="w-5 h-5 rounded-md border border-[var(--line)]" style={{ background: workspace.accentColor ?? "#E5482F" }} />
          {workspace.accentColor ?? "#E5482F (default)"}
        </span>
        <span className="flex-1" />
        {admin && <Link href="/admin/settings" className="btn sm">Change <ExternalLink className="w-3 h-3" /></Link>}
      </div>

      {/* ── Company info ────────────────────────────────────────────────── */}
      <SectionHead icon={<Building2 className="w-4 h-4" style={{ color: "var(--teal-on)" }} />} title="Company info"
        note="What this company does, for whom. Every AI draft is grounded in this." />
      <form action={saveOrgProfileAction} className="card mb-6 flex flex-col gap-3">
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">What they do, for whom, and what makes them different</span>
          <textarea name="description" rows={4} defaultValue={org?.description ?? ""} disabled={!editor}
            placeholder="e.g. LSI Media is a digital agency helping nonprofits grow through content-led SEO…"
            className="w-full text-sm leading-relaxed" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field name="industry" label="Industry" value={org?.industry ?? ""} disabled={!editor} />
          <Field name="audience" label="Primary audience" value={org?.audience ?? ""} disabled={!editor} />
        </div>
        {editor && <SubmitButton className="btn primary self-start">Save company info</SubmitButton>}
      </form>

      {/* ── Topics ──────────────────────────────────────────────────────── */}
      <SectionHead icon={<Tags className="w-4 h-4" style={{ color: "var(--violet-on)" }} />} title="Topics"
        note="The themes this company publishes about — used to steer ideation and posts." />
      {editor && (
        <form action={createTopicAction} className="card mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm flex-1 min-w-[180px]">
            <span className="block text-xs text-[var(--mute)] mb-1">Topic</span>
            <input name="name" required maxLength={120} placeholder="e.g. Nonprofit fundraising" className="w-full" />
          </label>
          <label className="text-sm flex-[2] min-w-[220px]">
            <span className="block text-xs text-[var(--mute)] mb-1">Related phrases (comma-separated, optional)</span>
            <input name="keywords" placeholder="donor retention, giving days" className="w-full" />
          </label>
          <SubmitButton className="btn primary">Add topic</SubmitButton>
        </form>
      )}
      {topics.length === 0 ? (
        <div className="card mb-6 text-xs text-[var(--mute)]">No topics yet. Add the themes this company writes and posts about.</div>
      ) : (
        <ul className="flex flex-col gap-2 mb-6">
          {topics.map((t) => {
            const kw = readJson<string[]>(t.keywords, []);
            const archived = t.status !== "active";
            return (
              <li key={t.id} className="card" style={archived ? { opacity: 0.6 } : undefined}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-sm">{t.name}</span>
                  {archived && <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>archived</span>}
                  <span className="flex-1" />
                  {editor && (
                    <>
                      <form action={toggleTopicStatusAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn sm" title={archived ? "Reactivate" : "Archive"}>
                          {archived ? <Check className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                        </button>
                      </form>
                      <form action={deleteTopicAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </form>
                    </>
                  )}
                </div>
                {editor ? (
                  <form action={updateTopicAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <label className="text-xs flex-1 min-w-[180px]">
                      <span className="block text-[10px] text-[var(--mute)] mb-1">Description</span>
                      <input name="description" defaultValue={t.description ?? ""} className="w-full text-xs" placeholder="What this topic covers" />
                    </label>
                    <label className="text-xs flex-1 min-w-[180px]">
                      <span className="block text-[10px] text-[var(--mute)] mb-1">Related phrases</span>
                      <input name="keywords" defaultValue={kw.join(", ")} className="w-full text-xs" />
                    </label>
                    <SubmitButton className="btn sm">Save</SubmitButton>
                  </form>
                ) : (
                  <>
                    {t.description && <p className="text-xs text-[var(--slate)]">{t.description}</p>}
                    {kw.length > 0 && <p className="text-[11px] font-mono text-[var(--mute)] mt-1">{kw.join(" · ")}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Personas ────────────────────────────────────────────────────── */}
      <SectionHead icon={<Users className="w-4 h-4" style={{ color: "var(--indigo-on)" }} />} title="Personas"
        note="The experts this company's content speaks as — voice, credentials, and what they never claim." />
      <div className="card mb-6">
        {personas.length === 0 ? (
          <p className="text-xs text-[var(--mute)] mb-2">No personas yet. They give drafts a credible, consistent voice.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 mb-2">
            {personas.map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--line-2)] text-xs">
                <span className="font-semibold">{p.name}</span>
                {p.role && <span className="text-[var(--mute)]">{p.role}</span>}
              </li>
            ))}
          </ul>
        )}
        <Link href="/blog/experts" className="btn sm">Manage personas <ExternalLink className="w-3 h-3" /></Link>
      </div>

      {/* ── Keywords + social ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 mb-6">
        <div>
          <SectionHead icon={<Hash className="w-4 h-4" style={{ color: "var(--amber-on)" }} />} title="Keywords" note="Search phrases with tiers, intent and clusters." />
          <div className="card">
            <p className="text-sm mb-1"><b>{keywordCount}</b> keyword{keywordCount === 1 ? "" : "s"}</p>
            {clusterNames.length > 0 && (
              <p className="text-[11px] font-mono text-[var(--mute)] mb-2">clusters: {clusterNames.join(" · ")}</p>
            )}
            <Link href="/blog/keywords" className="btn sm">Manage keywords <ExternalLink className="w-3 h-3" /></Link>
          </div>
        </div>
        <div>
          <SectionHead icon={<Share2 className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Social accounts" note="Profiles this workspace posts from." />
          <div className="card">
            {socials.length === 0 ? (
              <p className="text-xs text-[var(--mute)] mb-2">None connected yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 mb-2">
                {socials.map((s) => {
                  const net = networkFor(s.provider);
                  return (
                    <li key={s.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs" style={{ borderColor: net?.color ?? "var(--line-2)" }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                      {net?.label ?? s.provider}
                      <span className="text-[var(--mute)] truncate max-w-[120px]">{s.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {admin && <Link href="/admin/connections" className="btn sm">Connect accounts <ExternalLink className="w-3 h-3" /></Link>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[var(--mute)]">
        Tone of voice (the 7 Motifs) and asset policy live in <Link href="/blog/brand" className="underline">Blog → Brand</Link>.
      </p>
    </div>
  );
}

function SectionHead({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 flex-wrap">
      <span className="translate-y-0.5">{icon}</span>
      <h2 className="font-mono font-bold text-sm">{title}</h2>
      <span className="text-[11px] text-[var(--mute)]">{note}</span>
    </div>
  );
}

function Field({ name, label, value, placeholder, disabled }: { name: string; label: string; value: string; placeholder?: string; disabled?: boolean }) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-[var(--mute)] mb-1">{label}</span>
      <input name={name} defaultValue={value} placeholder={placeholder} disabled={disabled} className="w-full" />
    </label>
  );
}

function ColorField({ name, label, value, disabled }: { name: string; label: string; value: string; disabled?: boolean }) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-[var(--mute)] mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg border border-[var(--line)] shrink-0" style={{ background: value || "transparent" }} />
        <input name={name} defaultValue={value} placeholder="#RRGGBB" pattern="#[0-9a-fA-F]{6}" disabled={disabled}
          className="w-full font-mono text-sm" />
      </div>
    </label>
  );
}

function Banner({ kind, text }: { kind: "ok" | "err"; text: string }) {
  const ok = kind === "ok";
  return (
    <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", borderColor: ok ? "var(--green)" : "var(--rose)" }}>
      {ok ? <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> : <X className="w-4 h-4" style={{ color: "var(--rose-on)" }} />}
      {text}
    </div>
  );
}
