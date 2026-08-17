"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { storage } from "@/lib/storage";
import { writeAudit } from "@/lib/governance";
import {
  BRAND_DOC_MAX_BYTES,
  brandDocFormat,
  brandDocNeedsJob,
  extractBrandDocSync,
} from "@/lib/brand-docs";

/**
 * Brand context — differentiators, product/service features, and brand
 * documents. These are the FACTS a generation cannot infer, as opposed to the
 * Motifs, which are how it sounds.
 *
 * ADMIN throughout, like the rest of /blog/brand: one row here changes what
 * every AI surface in the workspace asserts about the company.
 *
 * ⚠ Nothing here is AI-assisted, deliberately. Assist refuses to draft from
 * nothing precisely because a model asked "what makes this company different?"
 * will happily invent an answer — and an invented differentiator would then be
 * injected into every future generation as fact. These fields are the cure for
 * that, so they must come from a person.
 */

const BRAND_PATH = "/blog/brand";

function flash(msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`${BRAND_PATH}?${kind}=${encodeURIComponent(msg)}#context`);
}

const KINDS = ["differentiator", "feature"] as const;
type FactKind = (typeof KINDS)[number];
const isKind = (v: string): v is FactKind => (KINDS as readonly string[]).includes(v);

const trim = (fd: FormData, k: string, max: number) => {
  const v = String(fd.get(k) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

// ---- Differentiators + features -------------------------------------------------

export async function saveBrandFactAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const kind = String(formData.get("kind") ?? "");
  if (!isKind(kind)) flash("Unknown kind.");
  const title = trim(formData, "title", 200);
  if (!title) {
    flash(kind === "feature" ? "Name the feature." : "Say what makes the company different.");
  }
  const detail = trim(formData, "detail", 1000);
  const subject = trim(formData, "subject", 120);
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    const existing = await db.brandFact.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) flash("That entry no longer exists.");
    await db.brandFact.update({ where: { id }, data: { title: title!, detail, subject, kind } });
  } else {
    // New rows land at the bottom of their own list.
    const last = await db.brandFact.findFirst({
      where: { workspaceId: workspace.id, kind },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await db.brandFact.create({
      data: { workspaceId: workspace.id, kind, title: title!, detail, subject, position: (last?.position ?? 0) + 1 },
    });
  }
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: id ? "brand.fact_updated" : "brand.fact_added",
    entityType: "brand_fact",
    entityId: id || null,
    meta: { kind, title },
  });
  revalidatePath(BRAND_PATH);
  flash(id ? "Saved." : `Added — every generation in this workspace can use it from now on.`, "ok");
}

/**
 * Move one entry up or down within its own kind.
 *
 * Position is what the prompt budget truncates from the bottom, so this is the
 * owner telling the app which facts matter most — not decoration.
 */
export async function reorderBrandFactAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "") === "up" ? -1 : 1;
  const row = await db.brandFact.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!row) flash("That entry no longer exists.");

  const siblings = await db.brandFact.findMany({
    where: { workspaceId: workspace.id, kind: row!.kind },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const at = siblings.findIndex((s) => s.id === row!.id);
  const swapWith = siblings[at + dir];
  if (!swapWith) {
    revalidatePath(BRAND_PATH);
    return; // already at the end — a no-op, not an error
  }
  // Rewrite the whole list's positions: rows created before this feature (and
  // any two rows that ended up sharing a position) would otherwise swap into a
  // tie and stop moving.
  const order = [...siblings];
  order[at] = swapWith;
  order[at + dir] = row!;
  await db.$transaction(
    order.map((r, i) => db.brandFact.update({ where: { id: r.id }, data: { position: i + 1 } })),
  );
  revalidatePath(BRAND_PATH);
}

// ---- Brand documents -----------------------------------------------------------

export async function uploadBrandDocumentAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const file = formData.get("file");
  const pasted = String(formData.get("pastedText") ?? "").trim();
  const givenName = trim(formData, "name", 200);

  // ── Pasted text: always available, and the answer for any format we can't
  // read. No storage key — the text IS the document.
  if (!(file instanceof File) || file.size === 0) {
    if (!pasted) flash("Choose a file or paste the document text.");
    const name = givenName ?? "Pasted notes";
    const doc = await db.brandDocument.create({
      data: { workspaceId: workspace.id, name, text: pasted.slice(0, 200_000), chars: Math.min(pasted.length, 200_000), state: "ready" },
    });
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "brand.document_added",
      entityType: "brand_document", entityId: doc.id, meta: { name, source: "pasted", chars: doc.chars },
    });
    revalidatePath(BRAND_PATH);
    flash(`“${name}” added — ${doc.chars.toLocaleString()} characters of context.`, "ok");
  }

  if (file.size > BRAND_DOC_MAX_BYTES) {
    flash(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${BRAND_DOC_MAX_BYTES / 1024 / 1024}MB.`);
  }
  const format = brandDocFormat(file.name, file.type);
  if (!format) {
    flash("That file type can't be read. Upload .docx, .pdf, .txt, .md, .csv or .rtf — or paste the text instead.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storage.put(file.name, bytes, file.type || "application/octet-stream");
  const name = givenName ?? file.name;

  // A format needing an LLM read (PDF) lands `extracting` and a job picks it up,
  // so the upload returns now instead of holding the request open for a
  // provider call. Everything else is decoded here — it costs nothing.
  if (brandDocNeedsJob(format)) {
    const doc = await db.brandDocument.create({
      data: {
        workspaceId: workspace.id, name, storageKey: stored.key,
        mimeType: file.type || null, bytes: file.size, state: "extracting",
      },
    });
    await jobs.enqueue(
      "brand.extractdoc",
      { workspaceId: workspace.id, documentId: doc.id },
      { refId: doc.id, workspaceId: workspace.id },
    );
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "brand.document_added",
      entityType: "brand_document", entityId: doc.id, meta: { name, source: "upload", format, state: "extracting" },
    });
    revalidatePath(BRAND_PATH);
    flash(`“${name}” uploaded — reading the PDF now. Refresh in a moment to see how much text came out.`, "ok");
  }

  const result = extractBrandDocSync(file.name, file.type || null, bytes)!;
  const failed = "error" in result;
  const doc = await db.brandDocument.create({
    data: {
      workspaceId: workspace.id, name, storageKey: stored.key,
      mimeType: file.type || null, bytes: file.size,
      text: failed ? null : result.text,
      chars: failed ? 0 : result.text.length,
      extractError: failed ? result.error : null,
      state: failed ? "failed" : "ready",
    },
  });
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "brand.document_added",
    entityType: "brand_document", entityId: doc.id,
    meta: { name, source: "upload", format, chars: doc.chars, failed },
  });
  revalidatePath(BRAND_PATH);
  // Say which happened. A stored file that contributes nothing must never look
  // like a success — that is the mock-fallback bug in another costume.
  flash(
    failed
      ? `“${name}” was stored but no text could be read: ${result.error}`
      : `“${name}” added — ${doc.chars.toLocaleString()} characters of context${result.truncated ? " (truncated to the per-document limit)" : ""}.`,
    failed ? "err" : "ok",
  );
}

/** Include/exclude one document from the prompt context without deleting it. */
export async function toggleBrandDocumentAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const doc = await db.brandDocument.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!doc) flash("That document no longer exists.");
  const next = !doc!.includeInContext;
  await db.brandDocument.update({ where: { id }, data: { includeInContext: next } });
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "brand.document_toggled",
    entityType: "brand_document", entityId: id, meta: { includeInContext: next },
  });
  revalidatePath(BRAND_PATH);
  flash(next ? `“${doc!.name}” is back in the AI's context.` : `“${doc!.name}” is kept but no longer sent to the AI.`, "ok");
}

/** Re-run extraction — for a PDF that failed while a key was missing, say. */
export async function retryBrandDocumentAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const doc = await db.brandDocument.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!doc) flash("That document no longer exists.");
  if (!doc!.storageKey) flash("There's nothing to re-read — this document's text was pasted, so edit or replace it instead.");
  await db.brandDocument.update({
    where: { id },
    data: { state: "extracting", extractError: null },
  });
  await jobs.enqueue(
    "brand.extractdoc",
    { workspaceId: workspace.id, documentId: id },
    { refId: id, workspaceId: workspace.id },
  );
  revalidatePath(BRAND_PATH);
  flash(`Re-reading “${doc!.name}”. Refresh in a moment.`, "ok");
}
