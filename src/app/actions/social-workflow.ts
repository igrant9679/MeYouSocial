"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { setWorkspaceSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { networkFor } from "@/lib/social/networks";

/**
 * Campaigns, the approval workflow, and bulk CSV import.
 *
 * Campaign management is ADMIN (workspace configuration, like the schedule);
 * assigning a post to a campaign is EDITOR (it's authorship). Approvals are
 * ADMIN by definition. CSV import is EDITOR — it creates content, and the
 * approval workflow applies to imported rows exactly as to composed ones.
 */

function backTo(msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`/social?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

// ---- Campaigns -----------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function createCampaignAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) backTo("Give the campaign a name.");
  const utmCampaign = String(formData.get("utmCampaign") ?? "").trim().slice(0, 80) || null;
  const colorRaw = String(formData.get("color") ?? "").trim();
  const color = HEX_RE.test(colorRaw) ? colorRaw : null;

  try {
    const c = await db.campaign.create({
      data: { workspaceId: workspace.id, name, utmCampaign, color },
    });
    await writeAudit({
      workspaceId: workspace.id, action: "campaign.created",
      entityType: "campaign", entityId: c.id, meta: { name },
    });
  } catch (e) {
    // Unique (workspaceId, name) — the one failure a user can cause here.
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002") {
      backTo(`A campaign called “${name}” already exists.`);
    }
    throw e;
  }
  revalidatePath("/social");
  backTo(`Campaign “${name}” created.`, "ok");
}

export async function toggleCampaignAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const c = await db.campaign.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!c) backTo("Campaign not found.");
  const status = c!.status === "active" ? "archived" : "active";
  await db.campaign.update({ where: { id: c!.id }, data: { status } });
  revalidatePath("/social");
  backTo(status === "archived"
    ? `“${c!.name}” archived — its posts keep their tag, new posts can't pick it.`
    : `“${c!.name}” is active again.`, "ok");
}

// ---- Approval workflow ---------------------------------------------------------

export async function approveSocialPostAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) backTo("Post not found.");
  if (post!.approval !== "pending" && post!.approval !== "changes") backTo("That post isn't waiting for approval.");

  // Honor the time the author asked for, if it's still ahead of us. A past
  // requested time doesn't auto-send — approval means "may go", not "goes now".
  const scheduleIt = post!.scheduledAt && post!.scheduledAt.getTime() > Date.now() - 60_000;
  await db.socialPost.update({
    where: { id: post!.id },
    data: {
      approval: "approved",
      approvedById: user.id,
      approvedAt: new Date(),
      reviewNote: null,
      status: scheduleIt ? "scheduled" : "draft",
    },
  });
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "social.approved",
    entityType: "social_post", entityId: post!.id,
  });
  if (post!.createdById && post!.createdById !== user.id) {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_decided",
      title: scheduleIt ? "Your post was approved and scheduled" : "Your post was approved",
      body: post!.text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post!.id,
      userIds: [post!.createdById],
    });
  }
  revalidatePath("/social");
  backTo(scheduleIt ? "Approved — it keeps its scheduled time." : "Approved — it's a draft, ready to queue or send.", "ok");
}

export async function requestChangesSocialPostAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) backTo("Post not found.");
  if (post!.approval !== "pending") backTo("That post isn't waiting for approval.");

  await db.socialPost.update({
    where: { id: post!.id },
    data: { approval: "changes", reviewNote: note || null, status: "draft" },
  });
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "social.changes_requested",
    entityType: "social_post", entityId: post!.id, meta: note ? { note } : {},
  });
  if (post!.createdById && post!.createdById !== user.id) {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_decided",
      title: "Changes requested on your post",
      body: note || post!.text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post!.id,
      userIds: [post!.createdById],
    });
  }
  revalidatePath("/social");
  backTo("Changes requested — the author has been notified.", "ok");
}

/** A draft that predates the workflow (approval = null) enters review here. */
export async function submitForApprovalAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) backTo("Post not found.");
  if (post!.status !== "draft" && post!.status !== "scheduled") backTo("Only unsent posts can be submitted.");
  if (post!.approval === "pending") backTo("It's already waiting for approval.", "ok");

  await db.socialPost.update({
    where: { id: post!.id },
    data: { approval: "pending", status: "draft" },
  });
  await notify({
    workspaceId: workspace.id,
    kind: "approval_needed",
    title: "A social post is waiting for approval",
    body: post!.text.slice(0, 140),
    path: "/social",
    entityType: "social_post",
    entityId: post!.id,
    excludeUserId: user.id,
  });
  revalidatePath("/social");
  backTo("Submitted for approval.", "ok");
}

// ---- Workflow settings ---------------------------------------------------------

export async function saveSocialWorkflowSettingsAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const approval = String(formData.get("requireApproval") ?? "") === "on";
  const evergreen = String(formData.get("evergreenFill") ?? "") === "on";
  const autoImage = String(formData.get("autoImage") ?? "") === "on";
  await setWorkspaceSetting(workspace.id, "social:require_approval", approval ? "true" : "false");
  await setWorkspaceSetting(workspace.id, "social:evergreen_fill", evergreen ? "true" : "false");
  // ⚠ Default-ON semantics: absent means on, so the OFF state must be written
  // explicitly — clearing the row would silently turn it back on.
  await setWorkspaceSetting(workspace.id, "social:auto_image", autoImage ? "true" : "false");
  revalidatePath("/social");
  backTo(
    `Approval workflow ${approval ? "on" : "off"} · evergreen auto-fill ${evergreen ? "on" : "off"} · auto-image ${autoImage ? "on" : "off"}.`,
    "ok",
  );
}

// ---- Bulk CSV import -----------------------------------------------------------

const CSV_MAX_ROWS = 200;
const CSV_MAX_BYTES = 1024 * 1024;

/**
 * A small RFC-4180-ish parser: quoted fields, doubled quotes, CR/LF. No
 * dependency for something this small, and the failure mode (a malformed
 * file) is reported per-row rather than crashing the import.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Bulk import: one post per row. Columns (header row, case-insensitive):
 *   text (required) · scheduledAt · networks · campaign · category ·
 *   evergreen · recycleEveryDays
 *
 * Text-only by design — media can't ride in a CSV — so media-required
 * networks named in a row are dropped from it, with a note, rather than
 * letting the row half-fail at the network later (same rule the composer
 * enforces). Unknown campaign names are row errors, not auto-creates: an
 * import should never invent workspace structure from a typo.
 */
export async function importSocialCsvAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) backTo("Choose a CSV file to import.");
  if (file.size > CSV_MAX_BYTES) backTo("That file is over 1 MB — split it up.");

  const rows = parseCsv(Buffer.from(await file.arrayBuffer()).toString("utf8"));
  if (rows.length < 2) backTo("The file needs a header row and at least one post row.");
  if (rows.length - 1 > CSV_MAX_ROWS) backTo(`That's ${rows.length - 1} rows — the cap is ${CSV_MAX_ROWS} per import.`);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iText = col("text");
  if (iText === -1) backTo('The header row needs a "text" column.');
  const iWhen = col("scheduledat");
  const iNets = col("networks");
  const iCampaign = col("campaign");
  const iCategory = col("category");
  const iEver = col("evergreen");
  const iDays = col("recycleeverydays");

  const accounts = await db.zernioAccount.findMany({
    where: { workspaceId: workspace.id, status: "connected" },
  });
  if (accounts.length === 0) backTo("No connected social accounts to import against.");
  const byPlatform = new Map<string, typeof accounts>();
  for (const a of accounts) {
    (byPlatform.get(a.platform) ?? byPlatform.set(a.platform, []).get(a.platform)!).push(a);
  }

  const campaigns = await db.campaign.findMany({ where: { workspaceId: workspace.id, status: "active" } });
  const campaignByName = new Map(campaigns.map((c) => [c.name.toLowerCase(), c.id]));

  const { getSetting } = await import("@/lib/settings");
  const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  const held = requireApproval && membership.role !== "ADMIN";
  const approval = requireApproval ? (held ? "pending" : "approved") : null;

  let created = 0;
  let scheduled = 0;
  const errors: string[] = [];
  const notes: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const rowNo = r + 1; // human numbering, header = row 1
    const text = (cells[iText] ?? "").trim().slice(0, 5000);
    if (!text) { errors.push(`row ${rowNo}: empty text`); continue; }

    // Networks: pipe/semicolon/space separated platform slugs; empty = all.
    const netRaw = iNets >= 0 ? (cells[iNets] ?? "").trim() : "";
    const wanted = netRaw
      ? netRaw.toLowerCase().split(/[|;,\s]+/).filter(Boolean)
      : [...byPlatform.keys()];
    const unknown = wanted.filter((w) => !byPlatform.has(w));
    if (unknown.length && netRaw) {
      errors.push(`row ${rowNo}: no connected account for ${unknown.join(", ")}`);
      continue;
    }
    // Text-only import: silently sending nothing to Instagram would be the
    // half-failure the composer refuses, so drop those networks with a note.
    const usable = wanted.filter((w) => byPlatform.has(w) && !networkFor(w)?.requiresMedia);
    const dropped = wanted.filter((w) => byPlatform.has(w) && networkFor(w)?.requiresMedia);
    if (dropped.length) notes.push(`row ${rowNo}: skipped ${dropped.join(", ")} (needs an image)`);
    if (usable.length === 0) { errors.push(`row ${rowNo}: every named network needs an image`); continue; }

    let campaignId: string | null = null;
    if (iCampaign >= 0 && (cells[iCampaign] ?? "").trim()) {
      campaignId = campaignByName.get(cells[iCampaign].trim().toLowerCase()) ?? null;
      if (!campaignId) { errors.push(`row ${rowNo}: unknown campaign “${cells[iCampaign].trim()}”`); continue; }
    }
    const category = iCategory >= 0 ? (cells[iCategory] ?? "").trim().slice(0, 40) || null : null;
    const evergreen = iEver >= 0 && /^(true|yes|1|y)$/i.test((cells[iEver] ?? "").trim());
    const recycleEveryDays = iDays >= 0
      ? Math.min(365, Math.max(1, parseInt((cells[iDays] ?? "").trim(), 10) || 30))
      : 30;

    let scheduledAt: Date | null = null;
    if (iWhen >= 0 && (cells[iWhen] ?? "").trim()) {
      const t = new Date(cells[iWhen].trim());
      if (Number.isNaN(t.getTime())) { errors.push(`row ${rowNo}: unreadable date “${cells[iWhen].trim()}”`); continue; }
      if (t.getTime() < Date.now() - 60_000) { errors.push(`row ${rowNo}: that time has already passed`); continue; }
      scheduledAt = t;
    }

    const targets = usable.flatMap((p) => byPlatform.get(p)!).map((a) => ({
      provider: a.platform,
      accountId: a.accountId,
      accountName: a.displayName ?? a.username ?? a.platform,
    }));

    const row = await db.socialPost.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        campaignId,
        category,
        evergreen,
        recycleEveryDays,
        approval,
        text,
        mediaKeys: "[]",
        scheduledAt,
        // Held rows stay drafts whatever the file asked for — same rule as the
        // composer. The requested time is kept for the approver.
        status: scheduledAt && !held ? "scheduled" : "draft",
        targets: { create: targets },
      },
    });
    // Imported rows are text-only by nature — the default-to-image job gives
    // each one a generated picture in the background, worker-paced.
    const { jobs } = await import("@/lib/jobs");
    await jobs.enqueue("social.autoimage", { postId: row.id }, { refId: row.id, workspaceId: workspace.id });
    created++;
    if (scheduledAt && !held) scheduled++;
  }

  if (created > 0 && held) {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: `${created} imported post${created === 1 ? " is" : "s are"} waiting for approval`,
      path: "/social",
      excludeUserId: user.id,
    });
  }
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "social.csv_imported",
    entityType: "social_post", meta: { created, scheduled, errors: errors.length },
  });

  revalidatePath("/social");
  const bits = [`Imported ${created} post${created === 1 ? "" : "s"}`];
  if (scheduled > 0) bits.push(`${scheduled} scheduled`);
  if (held && created > 0) bits.push("all awaiting approval");
  let msg = bits.join(" · ") + ".";
  if (notes.length) msg += ` ${notes.slice(0, 3).join("; ")}${notes.length > 3 ? "…" : ""}.`;
  if (errors.length) msg += ` ${errors.length} row${errors.length === 1 ? "" : "s"} skipped: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "…" : ""}`;
  backTo(msg, created > 0 ? "ok" : "err");
}
