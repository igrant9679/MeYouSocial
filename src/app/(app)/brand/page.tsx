import Link from "next/link";
import {
  Palette, Building2, Users, Tags, Hash, Share2, Check, X,
  ExternalLink, Sparkles, Image as ImageIcon,
} from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { SubmitButton } from "@/components/SubmitButton";
import { HelpTip } from "@/components/HelpTip";
import { BRAND_TIPS } from "@/lib/help-tips";
import { saveOrgProfileAction } from "@/app/actions/blog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { saveBrandIdentityAction, savePostImageSettingsAction } from "@/app/actions/brand-hub";
import { getSetting } from "@/lib/settings";
import { frameDetails } from "@/lib/social/post-image";
import { IMAGE_STYLES, IMAGE_STYLE_KEY, parseImageStyle } from "@/lib/social/image-styles";
import { FRAME_HANDLE_KEY, FRAME_ICONS_KEY, FRAME_LAYOUTS, FRAME_WEBSITE_KEY } from "@/lib/social/frame";
import { networkFor } from "@/lib/social/networks";
import { AiAssist } from "@/components/AiAssist";
import { EmptyState } from "@/components/EmptyState";
import { BrandContextSection } from "@/components/BrandContextSection";
import { CustomerBriefSection } from "@/components/CustomerBriefSection";
import { customerBrief } from "@/lib/assistant/customer-brief";
import { getActiveChannel } from "@/lib/channel";

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

  const [kit, org, personas, activeTopics, archivedTopics, keywordCount, clusters, socials] = await Promise.all([
    db.brandKit.findUnique({ where: { workspaceId: workspace.id } }),
    db.orgProfile.findUnique({ where: { workspaceId: workspace.id } }),
    db.smeProfile.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { createdAt: "asc" }, take: 24, select: { id: true, name: true, role: true, kind: true } }),
    db.topic.count({ where: { workspaceId: workspace.id, status: "active" } }),
    db.topic.count({ where: { workspaceId: workspace.id, status: { not: "active" } } }),
    db.keyword.count({ where: { workspaceId: workspace.id } }),
    db.keyword.findMany({ where: { workspaceId: workspace.id, cluster: { not: null } }, select: { cluster: true }, take: 200 }),
    db.zernioAccount.findMany({ where: { workspaceId: workspace.id, status: "connected" }, orderBy: { createdAt: "asc" } }),
  ]);
  // E-ART-20: the brand context (what makes us different, products, documents) lives here now.
  const [facts, documents] = await Promise.all([
    db.brandFact.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.brandDocument.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const differentiators = facts.filter((f) => f.kind === "differentiator");
  const features = facts.filter((f) => f.kind === "feature");
  const contextChars =
    differentiators.concat(features).reduce((n, f) => n + f.title.length + (f.detail?.length ?? 0), 0) +
    documents.filter((d) => d.includeInContext && d.text).reduce((n, d) => n + d.chars, 0);

  // What Elsie knows about the customer (lib/assistant/customer-brief.ts) — the same
  // object her prompt reads, read fresh here. A read that fails leaves the panel out.
  const { active: activeChannel } = await getActiveChannel();
  const brief = await customerBrief(workspace.id, activeChannel?.id ?? null, { fresh: true }).catch(() => null);

  // Post images (2026-11-23): the saved style and frame, and what the frame would print when a field is blank.
  const [styleRaw, handleRaw, websiteRaw, iconsRaw, frame] = await Promise.all([
    getSetting(IMAGE_STYLE_KEY, workspace.id).catch(() => ""),
    getSetting(FRAME_HANDLE_KEY, workspace.id).catch(() => ""),
    getSetting(FRAME_WEBSITE_KEY, workspace.id).catch(() => ""),
    getSetting(FRAME_ICONS_KEY, workspace.id).catch(() => ""),
    frameDetails(workspace.id).catch(() => null),
  ]);
  const imageStyleNow = parseImageStyle(styleRaw);

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
      {/* E-ART-20: the one editor for logo, colours, fonts and footer — Tone & motifs points here. */}
      <span id="identity" className="block scroll-mt-4" aria-hidden />
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
            <span className="text-2xs text-[var(--mute)]">
              Image sizes, tone guardrails and asset policy live in <Link href="/blog/brand" className="underline">Tone &amp; motifs</Link>.
            </span>
          </div>
        ) : (
          <p className="text-2xs text-[var(--mute)]">Admins can edit brand identity.</p>
        )}
      </form>

      {/* ── Post images: style + branded frame (2026-11-23) ─────────────── */}
      {/* The model paints the picture, never words; the frame is typeset by Publisher (lib/images/social-frame.ts). */}
      <span id="post-images" className="block scroll-mt-4" aria-hidden />
      <SectionHead icon={<ImageIcon className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Post images"
        note="The style of the pictures made for social posts, and the branded frame Publisher puts on them." />
      <form action={savePostImageSettingsAction} className="card mb-6 flex flex-col gap-4" data-post-images>
        <fieldset className="flex flex-col gap-2" disabled={!admin}>
          <legend className="text-xs font-semibold mb-1">Style</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {[...IMAGE_STYLES.map((s) => ({ id: s.id as string, label: s.label, blurb: s.blurb })),
              { id: "mix", label: "Mix", blurb: "A different style each time: the one used longest ago, so posts don't repeat." }].map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-xs border border-[var(--line)] rounded-lg p-2 cursor-pointer has-[:checked]:border-[var(--accent)]">
                <input type="radio" name="imageStyle" value={s.id} defaultChecked={imageStyleNow === s.id} className="mt-0.5" />
                <span><b>{s.label}</b><span className="block text-2xs text-[var(--mute)]">{s.blurb}</span></span>
              </label>
            ))}
          </div>
          <p className="text-2xs text-[var(--mute)] m-0">
            Used for every picture the app makes for a post. In Compose, the AI image button can use another style for one image.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2" disabled={!admin}>
          <legend className="text-xs font-semibold mb-1">Branded frame</legend>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {FRAME_LAYOUTS.map((l) => (
              <label key={l.id} className="flex flex-col gap-1.5 text-xs border border-[var(--line)] rounded-lg p-2 cursor-pointer has-[:checked]:border-[var(--accent)]">
                <span className="flex items-start gap-2">
                  <input type="radio" name="frame" value={l.id} defaultChecked={(frame?.layout ?? "off") === l.id} className="mt-0.5" />
                  <span><b>{l.label}</b><span className="block text-2xs text-[var(--mute)]">{l.blurb}</span></span>
                </span>
                {l.id !== "off" && (
                  // A sample on a stand-in picture with this workspace's own logo, colours and handle — nothing is spent.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/social/frame-sample?layout=${l.id}`} alt={`${l.label} sample`} loading="lazy" width={720} height={720}
                    className="w-full h-auto rounded-md border border-[var(--line)]" />
                )}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field name="frameHandle" label="Handle in the footer" value={handleRaw} placeholder={frame?.handle ?? "@yourhandle"} disabled={!admin} />
            <Field name="frameWebsite" label="Website in the footer" value={websiteRaw} placeholder={frame?.website ?? "www.example.com"} disabled={!admin} />
          </div>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" name="frameIcons" defaultChecked={iconsRaw !== "false"} />
            Show the icons of the connected networks{frame && frame.networks.length === 0 ? " (none are connected yet)" : ""}
          </label>
          <p className="text-2xs text-[var(--mute)] m-0">
            Blank fields use what Publisher finds: the handle your connected accounts share and the address of the connected website.
            The colours are the brand identity&apos;s above. The headline is written from each post, or typed in Compose. The AI never draws words:
            Publisher sets the headline, logo, handle and address itself, so they&apos;re never misspelled.
          </p>
          {frame && !frame.logo && (
            <p className="text-2xs m-0" style={{ color: "var(--amber-on)" }} data-frame-no-logo>
              No logo of at least 40 pixels is on file, so the frame shows the company name instead. Add one under{" "}
              <Link href="/admin/settings" className="underline">Settings → Workspace</Link> or as the logo URL above.
            </p>
          )}
        </fieldset>
        {admin ? (
          <SubmitButton className="btn primary self-start">Save post images</SubmitButton>
        ) : (
          <p className="text-2xs text-[var(--mute)] m-0">Admins can change post images.</p>
        )}
      </form>

      {/* ── App appearance (chrome) ─────────────────────────────────────── */}
      <SectionHead icon={<Sparkles className="w-4 h-4" style={{ color: "var(--accent-on)" }} />} title="App appearance"
        note="The accent colour and logo of the app itself, for everyone in this workspace." />
      <div className="card mb-6 flex items-center gap-3 flex-wrap">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="w-9 h-9 rounded-xl object-cover border border-[var(--line)]" />
        ) : (
          <span className="text-2xs font-mono text-[var(--mute)]">default logo</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs font-mono">
          <span className="w-5 h-5 rounded-md border border-[var(--line)]" style={{ background: workspace.accentColor ?? "var(--brand)" }} />
          {workspace.accentColor ?? "var(--brand) (default)"}
        </span>
        <span className="flex-1" />
        {admin && <Link href="/admin/settings" className="btn sm">Change <ExternalLink className="w-3 h-3" /></Link>}
      </div>

      {/* ── Company info ────────────────────────────────────────────────── */}
      {/* The one editor for the description, industry and audience (the Organization page redirects here). */}
      <span id="company" className="block scroll-mt-4" aria-hidden />
      <SectionHead icon={<Building2 className="w-4 h-4" style={{ color: "var(--teal-on)" }} />} title="Company info"
        note="What this company does, for whom. Every AI draft is grounded in this." />
      <form action={saveOrgProfileAction} className="card mb-6 flex flex-col gap-3">
        <div className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">What they do, for whom, and what makes them different</span>
          {/* WYSIWYG. `plainName` submits the plain-text projection, which is
              what AiAssist targets by name; the server re-derives it from the
              sanitized HTML on save regardless. */}
          <RichTextEditor
            name="descriptionHtml"
            plainName="description"
            initialHtml={org?.descriptionHtml ?? null}
            initialText={org?.description ?? ""}
            disabled={!editor}
            minHeight={180}
            placeholder="e.g. LSI Media is a digital agency helping nonprofits grow through content-led SEO…"
          />
        </div>
        {editor && (
          <AiAssist
            field="workspace.description"
            target="description"
            siblings={{ industry: "Industry", audience: "Primary audience" }}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field name="industry" label="Industry" value={org?.industry ?? ""} disabled={!editor} />
          <Field name="audience" label="Primary audience" value={org?.audience ?? ""} disabled={!editor} />
        </div>
        {editor && <SubmitButton className="btn primary self-start">Save company info</SubmitButton>}
      </form>

      {/* What makes the company different, its products, its documents (E-ART-20) — moved from Tone & motifs. */}
      <BrandContextSection admin={admin} differentiators={differentiators} features={features} documents={documents} contextChars={contextChars} />

      {/* ── Topics — moved to Ideas → Topics on 2026-09-21 ("Topics as the spine").
          A one-line pointer stays so nobody hunting for them here is stranded;
          /brand#topics deep links land on it. */}
      <SectionHead icon={<Tags className="w-4 h-4" style={{ color: "var(--violet-on)" }} />} title="Topics"
        note="The themes this company publishes about — now managed under Ideas, where they organise the board."
        tip={BRAND_TIPS.topics} />
      <div id="topics" className="card mb-6 flex flex-wrap items-center gap-3">
        <p className="text-xs flex-1 min-w-48 m-0">
          {activeTopics === 0
            ? "No topics yet. Research, ideas in every format, what gets made and what it earns all hang off them."
            : `${activeTopics} active topic${activeTopics === 1 ? "" : "s"}${archivedTopics ? ` · ${archivedTopics} archived` : ""}.`}
        </p>
        <Link href="/ideas/topics" className="btn sm">{activeTopics === 0 ? "Add the first topic" : "Manage topics"} <ExternalLink className="w-3 h-3" /></Link>
      </div>

      {/* ── Personas ────────────────────────────────────────────────────── */}
      {/* E-IDE-14: experts (who the content speaks as) and audience personas (who it's for) are different things. */}
      <SectionHead icon={<Users className="w-4 h-4" style={{ color: "var(--indigo-on)" }} />} title="Experts and personas"
        note="Experts are real people the content speaks as — their knowledge, credentials and what they never claim. Personas are the audiences it is written for." />
      <div className="card mb-6" data-brand-people>
        {personas.length === 0 ? (
          <EmptyState
            variant="inline"
            line="No experts or personas yet."
            note="An expert gives drafts a credible, consistent voice — who the content speaks as, their credentials, and what they never claim."
            action={editor ? { label: "Add an expert", href: "/blog/experts#add-expert" } : null}
          />
        ) : (
          (["expert", "persona"] as const).map((kind) => {
            const group = personas.filter((p) => (p.kind === "persona" ? "persona" : "expert") === kind);
            if (!group.length) return null;
            return (
              <div key={kind} className="mb-2" data-brand-group={kind}>
                <span className="block text-micro font-mono uppercase tracking-wider text-[var(--mute)] mb-1">{kind === "expert" ? "Experts — speak in drafts" : "Audience personas — content is for them"}</span>
                <ul className="flex flex-wrap gap-2 m-0 p-0 list-none">
                  {group.map((p) => (
                    <li key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--line-2)] text-xs">
                      <span className="font-semibold">{p.name}</span>
                      {p.role && <span className="text-[var(--mute)]">{p.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
        <Link href="/blog/experts" className="btn sm">Manage experts and personas <ExternalLink className="w-3 h-3" /></Link>
      </div>

      {/* ── What Elsie knows about the customer (2026-11-17) ─────────────── */}
      {brief && <CustomerBriefSection brief={brief} role={membership.role} channelName={activeChannel?.name ?? null} />}

      {/* ── Keywords + social ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 mb-6">
        <div>
          <SectionHead icon={<Hash className="w-4 h-4" style={{ color: "var(--amber-on)" }} />} title="Keywords" note="Search phrases with tiers, intent and clusters." />
          <div className="card">
            <p className="text-sm mb-1"><b>{keywordCount}</b> keyword{keywordCount === 1 ? "" : "s"}</p>
            {clusterNames.length > 0 && (
              <p className="text-2xs font-mono text-[var(--mute)] mb-2">clusters: {clusterNames.join(" · ")}</p>
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
                  const net = networkFor(s.platform);
                  return (
                    <li key={s.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs" style={{ borderColor: net?.color ?? "var(--line-2)" }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                      {net?.label ?? s.platform}
                      <span className="text-[var(--mute)] truncate max-w-[120px]">{s.displayName ?? s.username}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {admin && <Link href="/admin/connections" className="btn sm">Connect accounts <ExternalLink className="w-3 h-3" /></Link>}
          </div>
        </div>
      </div>

      <p className="text-2xs text-[var(--mute)]">
        Tone of voice (the 7 Motifs) and asset policy live in <Link href="/blog/brand" className="underline">Tone &amp; motifs</Link>.
      </p>
    </div>
  );
}

function SectionHead({ icon, title, note, tip }: { icon: React.ReactNode; title: string; note: string; tip?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 flex-wrap">
      <span className="translate-y-0.5">{icon}</span>
      <h2 className="font-mono font-bold text-sm flex items-center gap-1.5">
        {title}
        {tip && <HelpTip text={tip} side="bottom" wide />}
      </h2>
      <span className="text-2xs text-[var(--mute)]">{note}</span>
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
