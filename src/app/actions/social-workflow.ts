"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { setWorkspaceSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { CSV_MAX_BYTES, parseCsv, planImport } from "@/lib/social/csv-import";
import { approvePost, requestChanges } from "@/lib/social/review";

/**
 * Campaigns, the approval workflow, and bulk CSV import.
 *
 * Campaign management is ADMIN (workspace configuration, like the schedule);
 * assigning a post to a campaign is EDITOR (it's authorship). Approvals are
 * ADMIN by definition. CSV import is EDITOR — it creates content, and the
 * approval workflow applies to imported rows exactly as to composed ones.
 */

/**
 * Flash a message and land on a Social tab.
 *
 * Since /social became a set of tabs, "back" is no longer one place: approving
 * a post should return to Approvals, not bounce you to Overview mid-review.
 * Actions that belong to a tab shadow `backTo` with a one-line local bound to
 * it — that keeps every call site inside the action untouched.
 */
function flashTo(to: string, msg: string, kind: "err" | "ok"): never {
  redirect(`${to}?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

/**
 * ⚠ The `Flash` annotation is load-bearing: TypeScript only applies
 * never-returns control-flow narrowing through a VARIABLE when that variable
 * carries an explicit type annotation. Without it every `if (!post) backTo(…)`
 * below stops narrowing and the next line errors on a possibly-null value.
 */
type Flash = (msg: string, kind?: "err" | "ok") => never;

const tabFlash = (to: string): Flash => (msg, kind = "err") => flashTo(to, msg, kind);

// ---- Campaigns -----------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function createCampaignAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
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
  revalidatePath("/social", "layout");
  backTo(`Campaign “${name}” created.`, "ok");
}

export async function toggleCampaignAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const c = await db.campaign.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!c) backTo("Campaign not found.");
  const status = c!.status === "active" ? "archived" : "active";
  await db.campaign.update({ where: { id: c!.id }, data: { status } });
  revalidatePath("/social", "layout");
  backTo(status === "archived"
    ? `“${c!.name}” archived — its posts keep their tag, new posts can't pick it.`
    : `“${c!.name}” is active again.`, "ok");
}

// ---- Approval workflow ---------------------------------------------------------

export async function approveSocialPostAction(formData: FormData) {
  const backTo: Flash = tabFlash("/social/approvals");
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  // "Approve for a time" (E-SOC-02): a datetime-local, read in the posting timezone.
  const rawAt = String(formData.get("at") ?? "").trim();
  let at: Date | null = null;
  if (rawAt) {
    const { parseZonedInput, resolveTimeZone } = await import("@/lib/social/slots");
    const { timeZone } = await resolveTimeZone(workspace.id);
    at = parseZonedInput(rawAt, timeZone);
    if (!at) backTo("That time couldn't be read — pick a date and a time.");
  }
  const r = await approvePost(workspace.id, user.id, id, at);
  revalidatePath("/social", "layout");
  backTo(r.message, r.ok ? "ok" : "err");
}

export async function requestChangesSocialPostAction(formData: FormData) {
  const backTo: Flash = tabFlash("/social/approvals");
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const r = await requestChanges(workspace.id, user.id, id, note);
  if (r.ok) revalidatePath("/social", "layout");
  backTo(r.message, r.ok ? "ok" : "err");
}

/**
 * Approve or send back many held posts at once (E-SOC-02). Each goes through
 * the same path as its own button, one after another — so queue slots are
 * claimed in order — and the message counts what happened to them.
 */
export async function bulkReviewSocialAction(formData: FormData) {
  const backTo: Flash = tabFlash("/social/approvals");
  const { workspace, user } = await requireRole("ADMIN");
  const op = String(formData.get("op") ?? "");
  const ids = [...new Set(formData.getAll("sel").map(String).filter(Boolean))].slice(0, 100);
  if (op !== "approve" && op !== "changes") backTo("Choose Approve or Request changes.");
  if (!ids.length) backTo("Select at least one post first.");
  const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (op === "changes") {
    const note = String(formData.get("note") ?? "").trim().slice(0, 500);
    if (!note) backTo("Say what needs to change — the note goes to each post's author.");
    let n = 0;
    for (const id of ids) if ((await requestChanges(workspace.id, user.id, id, note)).ok) n++;
    revalidatePath("/social", "layout");
    const gone = ids.length - n;
    backTo(`Changes requested on ${s(n, "post", "posts")}.${gone ? ` ${s(gone, "was", "were")} no longer waiting.` : ""}`, n ? "ok" : "err");
  }

  const tally = { scheduled: 0, queued: 0, draft: 0, skipped: 0 };
  const reasons = new Set<string>();
  for (const id of ids) {
    const r = await approvePost(workspace.id, user.id, id, null, ["pending"]);
    if (!r.ok) { tally.skipped++; continue; }
    tally[r.outcome ?? "draft"]++;
    if (r.reason) reasons.add(r.reason);
  }
  revalidatePath("/social", "layout");
  const approved = ids.length - tally.skipped;
  const parts = [
    tally.scheduled ? `${s(tally.scheduled, "keeps its time", "keep their times")}` : "",
    tally.queued ? `${tally.queued} queued` : "",
    tally.draft ? `${s(tally.draft, "stays a draft", "stay drafts")}${reasons.size ? ` (${[...reasons].slice(0, 2).join("; ")})` : ""}` : "",
  ].filter(Boolean);
  backTo(
    `Approved ${s(approved, "post", "posts")}${parts.length ? `: ${parts.join(", ")}` : ""}.${tally.skipped ? ` ${s(tally.skipped, "was", "were")} no longer waiting.` : ""}`,
    approved ? "ok" : "err",
  );
}

/**
 * A note on a post's review thread (E-SOC-02): its author and its reviewers
 * talk there instead of through one overwritten reviewNote. Everyone already
 * on the thread hears about it; the author writing into an empty thread
 * reaches the admins, who are the reviewers. Kept as the record — no edit or
 * delete.
 */
export async function addSocialPostCommentAction(formData: FormData) {
  const raw = String(formData.get("back") ?? "");
  const to = raw.startsWith("/social") && !raw.startsWith("//") ? raw.split(/[?#]/)[0] : "/social/approvals";
  const backTo: Flash = tabFlash(to);
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 1000);
  if (!body) backTo("Write the comment first.");
  const post = await db.socialPost.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, createdById: true, approval: true, comments: { select: { authorId: true } } },
  });
  if (!post) backTo("Post not found.");
  await db.socialPostComment.create({ data: { postId: post!.id, authorId: user.id, body } });
  const onThread = [post!.createdById, ...post!.comments.map((c) => c.authorId)].filter((x): x is string => !!x && x !== user.id);
  const recipients = onThread.length
    ? onThread
    : (await db.membership.findMany({ where: { workspaceId: workspace.id, status: "active", role: "ADMIN" }, select: { userId: true } }))
        .map((m) => m.userId).filter((u) => u !== user.id);
  if (recipients.length) {
    await notify({
      workspaceId: workspace.id,
      kind: "comment",
      title: "A comment on a social post",
      body: body.slice(0, 140),
      path: post!.approval === "pending" || post!.approval === "changes" ? "/social/approvals" : `/social/${post!.id}/edit`,
      entityType: "social_post",
      entityId: post!.id,
      userIds: recipients,
    });
  }
  revalidatePath("/social", "layout");
  backTo("Comment added.", "ok");
}

/** A draft that predates the workflow (approval = null) enters review here. */
export async function submitForApprovalAction(formData: FormData) {
  const backTo: Flash = tabFlash("/social/approvals");
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
  revalidatePath("/social", "layout");
  backTo("Submitted for approval.", "ok");
}

// ---- Post categories (Socialmonials parity, 2026-10-17) ----------------------------

export async function addCategoryAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const { addCategory } = await import("@/lib/social/categories");
  const added = await addCategory(workspace.id, String(formData.get("name") ?? ""));
  revalidatePath("/social", "layout");
  backTo(added ? `Category “${added}” is on the list.` : "Give the category a name.", added ? "ok" : "err");
}

export async function removeCategoryAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "");
  const { removeCategory } = await import("@/lib/social/categories");
  const gone = await removeCategory(workspace.id, name);
  revalidatePath("/social", "layout");
  backTo(gone ? `Removed “${name}” from the list — posts already filed under it keep the label.` : "That category isn't on the list.", gone ? "ok" : "err");
}

// ---- Workflow settings ---------------------------------------------------------

export async function saveSocialWorkflowSettingsAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/automation");
  const { workspace } = await requireRole("ADMIN");
  const evergreen = String(formData.get("evergreenFill") ?? "") === "on";
  const autoqueue = String(formData.get("autoQueue") ?? "") === "on";
  const autoImage = String(formData.get("autoImage") ?? "") === "on";
  const autogen = String(formData.get("autogen") ?? "") === "on";
  const autogenWeekly = Math.min(50, Math.max(1, parseInt(String(formData.get("autogenWeekly") ?? "5"), 10) || 5));
  const autogenCampaignRaw = String(formData.get("autogenCampaign") ?? "").trim();
  const autogenCampaign = autogenCampaignRaw
    ? (await db.campaign.findFirst({ where: { id: autogenCampaignRaw, workspaceId: workspace.id, status: "active" }, select: { id: true } }))?.id ?? ""
    : "";
  await setWorkspaceSetting(workspace.id, "social:evergreen_fill", evergreen ? "true" : "false");
  await setWorkspaceSetting(workspace.id, "social:autoqueue", autoqueue ? "true" : "false");
  // ⚠ Default-ON semantics: absent means on, so the OFF state must be written
  // explicitly — clearing the row would silently turn it back on.
  await setWorkspaceSetting(workspace.id, "social:auto_image", autoImage ? "true" : "false");
  await setWorkspaceSetting(workspace.id, "social:autogen", autogen ? "true" : "false");
  await setWorkspaceSetting(workspace.id, "social:autogen_weekly", String(autogenWeekly));
  await setWorkspaceSetting(workspace.id, "social:autogen_campaign", autogenCampaign);
  // The social idea gate (Topics as the spine): auto | human. Absent = auto.
  const socialGate = String(formData.get("socialGate") ?? "") === "human" ? "human" : "auto";
  await setWorkspaceSetting(workspace.id, "ideas:social_gate", socialGate);
  // Rollback dial: the page only offers "Use ideas" when the workspace is on
  // rotation; the rotation itself is set by an operator (a script or a DB
  // row), never from this form, so nobody switches a feed back by accident.
  if (String(formData.get("socialSourceCurrent") ?? "") === "rotation" && String(formData.get("socialSourceIdeas") ?? "") === "on") {
    await setWorkspaceSetting(workspace.id, "social:source", "ideas");
  }
  revalidatePath("/social", "layout");
  revalidatePath("/ideas", "layout");
  backTo(
    `Auto-queue on approval ${autoqueue ? "on" : "off"} · evergreen fill ${evergreen ? "on" : "off"} · auto-image ${autoImage ? "on" : "off"} · auto-generate ${autogen ? `${autogenWeekly}/week` : "off"} · social ideas ${socialGate === "human" ? "wait for a person" : "approve themselves"}.`,
    "ok",
  );
}

// ---- Bulk CSV import -----------------------------------------------------------

export type CsvImportResult = {
  mode: "check" | "import";
  ok: boolean;
  /** One line for the whole file. */
  summary: string;
  rows: Array<{ row: number; ok: boolean; message: string }>;
};

/**
 * Bulk import (E-SOC-16): "Check the file" plans every row and writes nothing;
 * "Import" creates the rows that pass and skips the rest. Both report row by
 * row (lib/social/csv-import.ts holds the rules, so the check can't disagree
 * with the import). Used with useActionState — it returns, never redirects.
 */
export async function importSocialCsvAction(_prev: CsvImportResult | null, formData: FormData): Promise<CsvImportResult> {
  const mode = formData.get("op") === "check" ? "check" : "import";
  const done = (summary: string, ok = false, rows: CsvImportResult["rows"] = []): CsvImportResult => ({ mode, ok, summary, rows });
  const { workspace, user, membership } = await requireRole("EDITOR");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return done("Choose a CSV file first.");
  if (file.size > CSV_MAX_BYTES) return done("That file is over 1 MB — split it up.");

  const [accounts, campaigns, media] = await Promise.all([
    db.zernioAccount.findMany({ where: { workspaceId: workspace.id, status: "connected" }, select: { platform: true, accountId: true, displayName: true, username: true } }),
    db.campaign.findMany({ where: { workspaceId: workspace.id, status: "active" }, select: { id: true, name: true } }),
    db.mediaItem.findMany({ where: { workspaceId: workspace.id }, select: { key: true, name: true, contentType: true } }),
  ]);
  const { getPostingTimeZone, formatInZone } = await import("@/lib/social/slots");
  const timeZone = await getPostingTimeZone(workspace.id);
  const { header, plans } = planImport(parseCsv(Buffer.from(await file.arrayBuffer()).toString("utf8")), { accounts, campaigns, media, timeZone, now: Date.now() });
  if (header) return done(header);

  const good = plans.filter((p) => p.ok && p.post);
  const rowsOut = plans.map((p) => ({
    row: p.row,
    ok: p.ok,
    message: p.ok && p.post
      ? [`${p.post.scheduledAt ? `${formatInZone(p.post.scheduledAt, p.post.zone)} (${p.post.zone})` : "draft, no date"}`, p.post.targets.map((t) => t.provider).filter((v, i, a) => a.indexOf(v) === i).join(", "), p.post.mediaKeys.length ? `${p.post.mediaKeys.length} media` : "", ...p.notes].filter(Boolean).join(" · ")
      : `${p.error}${p.notes.length ? ` (${p.notes.join("; ")})` : ""}`,
  }));
  const bad = plans.length - good.length;
  if (mode === "check") {
    return done(`${good.length} of ${plans.length} row${plans.length === 1 ? "" : "s"} would import${bad ? `; ${bad} would be skipped — see why below` : ""}. Nothing was written.`, bad === 0, rowsOut);
  }

  const { getSetting } = await import("@/lib/settings");
  const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  const held = requireApproval && membership.role !== "ADMIN";
  const approval = requireApproval ? (held ? "pending" : "approved") : null;
  const { jobs } = await import("@/lib/jobs");
  let scheduled = 0;
  for (const p of good) {
    const post = p.post!;
    const row = await db.socialPost.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        source: "import",
        campaignId: post.campaignId,
        category: post.category,
        evergreen: post.evergreen,
        recycleEveryDays: post.recycleEveryDays,
        approval,
        text: post.text,
        mediaKeys: JSON.stringify(post.mediaKeys),
        scheduledAt: post.scheduledAt,
        timeChosen: post.scheduledAt != null, // a time from the file, not a slot (SOC-17)
        // Held rows stay drafts whatever the file asked for — same rule as the
        // composer. The requested time is kept for the approver.
        status: post.scheduledAt && !held ? "scheduled" : "draft",
        targets: { create: post.targets },
      },
    });
    // A row with no media gets the default-to-image treatment, worker-paced.
    if (!post.mediaKeys.length) await jobs.enqueue("social.autoimage", { postId: row.id }, { refId: row.id, workspaceId: workspace.id });
    if (post.scheduledAt && !held) scheduled++;
  }
  if (good.length > 0 && held) {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: `${good.length} imported post${good.length === 1 ? " is" : "s are"} waiting for approval`,
      path: "/social",
      excludeUserId: user.id,
    });
  }
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "social.csv_imported",
    entityType: "social_post", meta: { created: good.length, scheduled, errors: bad },
  });
  revalidatePath("/social", "layout");
  const bits = [`Imported ${good.length} post${good.length === 1 ? "" : "s"}`];
  if (scheduled) bits.push(`${scheduled} scheduled`);
  if (held && good.length) bits.push("all awaiting approval");
  if (bad) bits.push(`${bad} row${bad === 1 ? "" : "s"} skipped — see why below`);
  return done(`${bits.join(" · ")}.`, good.length > 0, rowsOut);
}

/**
 * Require approval for social posts — its own dial under Settings → People
 * (One-Loop step 5: "who can do what"), so the auto-dials form under
 * Automation can be saved without touching it.
 */
export async function setRequireApprovalAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/people");
  const { workspace } = await requireRole("ADMIN");
  const on = String(formData.get("enabled") ?? "") === "true";
  await setWorkspaceSetting(workspace.id, "social:require_approval", on ? "true" : "false");
  revalidatePath("/social", "layout");
  revalidatePath("/setup", "layout");
  revalidatePath("/inbox");
  backTo(on ? "Social posts now need an admin's approval before they go out." : "Social posts no longer need approval — approved and auto-generated posts take the next free slot.", "ok");
}
