"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import {
  DEFAULT_HEADING_SPEC,
  HEADING_LEVELS,
  MOTIF_PLATFORMS,
  MOTIF_SEED_BY_KEY,
  ensureMotifDirectives,
  isMotifKey,
  readMotifWeights,
  serializeMotifs,
  type HeadingStyle,
} from "@/lib/motifs";

/**
 * FR-2 — brand kit, heading/image spec, and the editable 7 Motifs directives.
 * All admin acts: these settings steer every generation in the workspace, so
 * they sit behind the same gate as integrations.
 */

const BRAND_PATH = "/blog/brand";

const str = (fd: FormData, k: string, max = 500) => {
  const v = String(fd.get(k) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

function intField(fd: FormData, k: string, fallback: number, min: number, max: number): number {
  const n = parseInt(String(fd.get(k) ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function saveBrandKitAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const data = {
    primaryColor: str(formData, "primaryColor", 32),
    secondaryColor: str(formData, "secondaryColor", 32),
    accentColor: str(formData, "accentColor", 32),
    headingFont: str(formData, "headingFont", 80),
    bodyFont: str(formData, "bodyFont", 80),
    logoUrl: str(formData, "logoUrl", 500),
    footerCredit: str(formData, "footerCredit", 300),
    toneGuardrails: str(formData, "toneGuardrails", 2000),
    featuredImageWidth: intField(formData, "featuredImageWidth", 1920, 200, 6000),
    featuredImageHeight: intField(formData, "featuredImageHeight", 1080, 200, 6000),
    ogImageWidth: intField(formData, "ogImageWidth", 1200, 200, 6000),
    ogImageHeight: intField(formData, "ogImageHeight", 630, 200, 6000),
    // FR-8 asset policy
    requireImagesToPublish: formData.get("requireImagesToPublish") === "on",
    aiImagesEnabled: formData.get("aiImagesEnabled") === "on",
    brandInBodyImages: formData.get("brandInBodyImages") === "on",
  };
  await db.brandKit.upsert({
    where: { workspaceId: workspace.id },
    update: data,
    create: { workspaceId: workspace.id, ...data },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "brand.kit_saved",
    entityType: "brand_kit",
  });
  revalidatePath(BRAND_PATH);
}

/** H1–H6 pixel size + top/bottom margins (+ optional weight/line-height/colour). */
export async function saveHeadingSpecAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const spec: Record<string, HeadingStyle> = {};
  for (const level of HEADING_LEVELS) {
    const d = DEFAULT_HEADING_SPEC[level];
    const weight = intField(formData, `${level}_weight`, d.weight ?? 600, 100, 900);
    const lineHeightRaw = Number(String(formData.get(`${level}_lineHeight`) ?? ""));
    const color = str(formData, `${level}_color`, 32);
    spec[level] = {
      px: intField(formData, `${level}_px`, d.px, 8, 120),
      marginTop: intField(formData, `${level}_marginTop`, d.marginTop, 0, 200),
      marginBottom: intField(formData, `${level}_marginBottom`, d.marginBottom, 0, 200),
      weight,
      lineHeight: Number.isFinite(lineHeightRaw) && lineHeightRaw > 0 ? Math.min(3, lineHeightRaw) : d.lineHeight,
      ...(color ? { color } : {}),
    };
  }
  await db.brandKit.upsert({
    where: { workspaceId: workspace.id },
    update: { headingSpec: JSON.stringify(spec) },
    create: { workspaceId: workspace.id, headingSpec: JSON.stringify(spec) },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "brand.heading_spec_saved",
    entityType: "brand_kit",
  });
  revalidatePath(BRAND_PATH);
}

// ---- Motif directives ---------------------------------------------------------

/** Edit one motif's directive. The previous text is snapshotted as a version. */
export async function saveMotifDirectiveAction(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  if (!isMotifKey(key)) return;
  const { user, workspace } = await requireRole("ADMIN");
  await ensureMotifDirectives(workspace.id);
  const current = await db.motifDirective.findUnique({
    where: { workspaceId_key: { workspaceId: workspace.id, key } },
  });
  if (!current) return;

  const next = {
    label: str(formData, "label", 60) ?? current.label,
    summary: str(formData, "summary", 300) ?? current.summary,
    voice: str(formData, "voice", 800) ?? current.voice,
    rhythm: str(formData, "rhythm", 800) ?? current.rhythm,
    evidence: str(formData, "evidence", 800) ?? current.evidence,
    cta: str(formData, "cta", 400) ?? current.cta,
  };
  const unchanged =
    next.label === current.label &&
    next.summary === current.summary &&
    next.voice === current.voice &&
    next.rhythm === current.rhythm &&
    next.evidence === current.evidence &&
    next.cta === current.cta;
  if (unchanged) return;

  await db.motifDirectiveVersion.create({
    data: {
      directiveId: current.id,
      version: current.version,
      label: current.label,
      data: JSON.stringify({
        label: current.label,
        summary: current.summary,
        voice: current.voice,
        rhythm: current.rhythm,
        evidence: current.evidence,
        cta: current.cta,
      }),
      editedById: user.id,
    },
  });
  await db.motifDirective.update({
    where: { id: current.id },
    data: { ...next, version: current.version + 1 },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "motif.directive_saved",
    entityType: "motif_directive",
    entityId: current.id,
    meta: { key, version: current.version + 1 },
  });
  revalidatePath(BRAND_PATH);
}

/** Restore a previous version (itself recorded as a new version — never lossy). */
export async function restoreMotifDirectiveAction(formData: FormData) {
  const versionId = String(formData.get("versionId") ?? "");
  const { user, workspace } = await requireRole("ADMIN");
  const version = await db.motifDirectiveVersion.findFirst({
    where: { id: versionId, directive: { workspaceId: workspace.id } },
    include: { directive: true },
  });
  if (!version) return;
  let payload: Partial<Record<string, string>> = {};
  try {
    payload = JSON.parse(version.data) as Partial<Record<string, string>>;
  } catch {
    return;
  }
  const d = version.directive;
  await db.motifDirectiveVersion.create({
    data: {
      directiveId: d.id,
      version: d.version,
      label: d.label,
      data: JSON.stringify({
        label: d.label,
        summary: d.summary,
        voice: d.voice,
        rhythm: d.rhythm,
        evidence: d.evidence,
        cta: d.cta,
      }),
      editedById: user.id,
    },
  });
  await db.motifDirective.update({
    where: { id: d.id },
    data: {
      label: payload.label ?? d.label,
      summary: payload.summary ?? d.summary,
      voice: payload.voice ?? d.voice,
      rhythm: payload.rhythm ?? d.rhythm,
      evidence: payload.evidence ?? d.evidence,
      cta: payload.cta ?? d.cta,
      version: d.version + 1,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "motif.directive_restored",
    entityType: "motif_directive",
    entityId: d.id,
    meta: { restoredFrom: version.version },
  });
  revalidatePath(BRAND_PATH);
}

/** Reset one motif back to the framework seed text (kept as a version too). */
export async function resetMotifDirectiveAction(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  if (!isMotifKey(key)) return;
  const seed = MOTIF_SEED_BY_KEY.get(key);
  if (!seed) return;
  const { user, workspace } = await requireRole("ADMIN");
  await ensureMotifDirectives(workspace.id);
  const current = await db.motifDirective.findUnique({
    where: { workspaceId_key: { workspaceId: workspace.id, key } },
  });
  if (!current) return;
  await db.motifDirectiveVersion.create({
    data: {
      directiveId: current.id,
      version: current.version,
      label: current.label,
      data: JSON.stringify({
        label: current.label,
        summary: current.summary,
        voice: current.voice,
        rhythm: current.rhythm,
        evidence: current.evidence,
        cta: current.cta,
      }),
      editedById: user.id,
    },
  });
  await db.motifDirective.update({
    where: { id: current.id },
    data: {
      label: seed.label,
      summary: seed.summary,
      voice: seed.voice,
      rhythm: seed.rhythm,
      evidence: seed.evidence,
      cta: seed.cta,
      version: current.version + 1,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "motif.directive_reset",
    entityType: "motif_directive",
    entityId: current.id,
    meta: { key },
  });
  revalidatePath(BRAND_PATH);
}

// ---- Defaults + platform mapping ------------------------------------------------

export async function saveMotifDefaultAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "").trim();
  const tierRaw = parseInt(String(formData.get("tier") ?? ""), 10);
  const tier = Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 4 ? tierRaw : null;
  const audience = str(formData, "audience", 120);
  const motifs = serializeMotifs(readMotifWeights(formData));
  if (motifs === "[]") return; // a default with no motifs is just noise

  if (id) {
    const existing = await db.motifDefault.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) return;
    await db.motifDefault.update({ where: { id }, data: { tier, audience, motifs } });
  } else {
    await db.motifDefault.create({ data: { workspaceId: workspace.id, tier, audience, motifs } });
  }
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "motif.default_saved",
    entityType: "motif_default",
    meta: { tier, audience, motifs },
  });
  revalidatePath(BRAND_PATH);
}

export async function deleteMotifDefaultAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireRole("ADMIN");
  await db.motifDefault.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath(BRAND_PATH);
}

export async function setPlatformMotifAction(formData: FormData) {
  const platform = String(formData.get("platform") ?? "");
  const motifKey = String(formData.get("motifKey") ?? "");
  if (!(MOTIF_PLATFORMS as readonly string[]).includes(platform)) return;
  const { user, workspace } = await requireRole("ADMIN");

  if (!motifKey) {
    await db.platformMotif.deleteMany({ where: { workspaceId: workspace.id, platform } });
  } else {
    if (!isMotifKey(motifKey)) return;
    await db.platformMotif.upsert({
      where: { workspaceId_platform: { workspaceId: workspace.id, platform } },
      update: { motifKey },
      create: { workspaceId: workspace.id, platform, motifKey },
    });
  }
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "motif.platform_mapped",
    entityType: "platform_motif",
    meta: { platform, motifKey: motifKey || null },
  });
  revalidatePath(BRAND_PATH);
}
