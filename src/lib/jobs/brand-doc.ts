import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { storage } from "@/lib/storage";
import { writeAudit } from "@/lib/governance";
import { extractBrandDocPdf, extractBrandDocSync, brandDocFormat } from "@/lib/brand-docs";

/**
 * Read an uploaded brand document into text.
 *
 * Only formats that need a provider call (PDF, via Gemini) actually require the
 * job — text and DOCX are decoded inline in the upload action. It exists as a
 * job for the same reason `social.autoimage` does: a provider call inside the
 * request would hang the upload, and a killed container mid-read would leave a
 * document stuck at `extracting` forever with nothing to resume it. The durable
 * queue requeues it instead.
 *
 * ⚠ It NEVER leaves `state: "extracting"` behind. Every exit writes either text
 * or an `extractError`, because a document that silently contributes nothing to
 * a prompt is the failure this whole feature is trying to avoid.
 */

let registered = false;

export function registerBrandDocJobs() {
  if (registered) return;
  registered = true;

  jobs.register<{ workspaceId: string; documentId: string }>("brand.extractdoc", async ({ workspaceId, documentId }, ctx) => {
    await ctx.progress(0.1);
    const doc = await db.brandDocument.findFirst({ where: { id: documentId, workspaceId } });
    if (!doc) return; // deleted while queued — nothing to do, and not an error
    if (!doc.storageKey) {
      await db.brandDocument.update({
        where: { id: doc.id },
        data: { state: "failed", extractError: "This document has no stored file to read." },
      });
      return;
    }

    const bytes = await storage.get(doc.storageKey);
    if (!bytes) {
      await db.brandDocument.update({
        where: { id: doc.id },
        data: { state: "failed", extractError: "The stored file could not be read back from storage." },
      });
      return;
    }
    await ctx.progress(0.3);

    const format = brandDocFormat(doc.name, doc.mimeType);
    const result =
      format === "pdf"
        ? await extractBrandDocPdf(bytes, workspaceId)
        : extractBrandDocSync(doc.name, doc.mimeType, bytes) ?? { error: "Unsupported format." };
    await ctx.progress(0.9);

    const failed = "error" in result;
    await db.brandDocument.update({
      where: { id: doc.id },
      data: {
        text: failed ? null : result.text,
        chars: failed ? 0 : result.text.length,
        extractError: failed ? result.error : null,
        state: failed ? "failed" : "ready",
      },
    });
    await writeAudit({
      workspaceId,
      action: "brand.document_extracted",
      entityType: "brand_document",
      entityId: doc.id,
      meta: failed ? { failed: true, reason: result.error.slice(0, 200) } : { chars: result.text.length, truncated: result.truncated },
    });
    ctx.log(failed ? `failed: ${result.error}` : `${result.text.length} chars`);
    await ctx.progress(1);
  });
}
