import { ChevronDown, ChevronUp, FileText, Sparkles } from "lucide-react";
import type { BrandDocument, BrandFact } from "@prisma/client";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { BRAND_DOC_ACCEPT, BRAND_DOC_MAX_BYTES } from "@/lib/brand-docs";
import {
  reorderBrandFactAction,
  retryBrandDocumentAction,
  saveBrandFactAction,
  toggleBrandDocumentAction,
  uploadBrandDocumentAction,
} from "@/app/actions/brand-context";

/**
 * Brand context: the FACTS every generation needs and cannot infer — what makes
 * the company different, what its products actually do, and the text of its own
 * brand documents.
 *
 * Sits above the Motifs on /blog/brand because it answers a different question:
 * the Motifs decide how the workspace SOUNDS, these rows decide what it may
 * SAY. Assist refuses to draft from nothing for exactly this reason, so nothing
 * on this card is AI-assisted — an invented differentiator would be injected
 * into every later generation as fact.
 *
 * All server components: forms + server actions, no client JS beyond the shared
 * SubmitButton/DeleteButton.
 */

const ORDER_HINT =
  "Order matters: when a prompt runs out of room the list is cut from the bottom, so put the most important first.";

function FactRow({
  fact,
  admin,
  isFirst,
  isLast,
}: {
  fact: BrandFact;
  admin: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <details className="rounded-lg border border-[var(--line)] px-3 py-2">
      <summary className="cursor-pointer text-xs flex items-start gap-2">
        <span className="flex-1">
          {fact.subject && <b className="font-mono text-[10px] mr-1">{fact.subject}</b>}
          <b>{fact.title}</b>
          {fact.detail && <span className="text-[var(--mute)]"> — {fact.detail.slice(0, 120)}{fact.detail.length > 120 ? "…" : ""}</span>}
        </span>
        {admin && (
          <span className="flex items-center gap-1 shrink-0">
            {/* Separate one-field forms: a reorder must not carry the edit
                fields, or a stray click would save a half-typed row. */}
            {!isFirst && (
              <form action={reorderBrandFactAction}>
                <input type="hidden" name="id" value={fact.id} />
                <input type="hidden" name="dir" value="up" />
                <SubmitButton className="btn ghost !px-1 !py-0.5" title="Move up"><ChevronUp className="w-3 h-3" /></SubmitButton>
              </form>
            )}
            {!isLast && (
              <form action={reorderBrandFactAction}>
                <input type="hidden" name="id" value={fact.id} />
                <input type="hidden" name="dir" value="down" />
                <SubmitButton className="btn ghost !px-1 !py-0.5" title="Move down"><ChevronDown className="w-3 h-3" /></SubmitButton>
              </form>
            )}
          </span>
        )}
      </summary>
      {admin && (
        <form action={saveBrandFactAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="id" value={fact.id} />
          <input type="hidden" name="kind" value={fact.kind} />
          {fact.kind === "feature" && (
            <label className="text-xs">
              <span className="block text-[10px] text-[var(--mute)] mb-1">Product or service</span>
              <input name="subject" defaultValue={fact.subject ?? ""} className="w-full text-xs" />
            </label>
          )}
          <label className="text-xs">
            <span className="block text-[10px] text-[var(--mute)] mb-1">{fact.kind === "feature" ? "Feature" : "Differentiator"}</span>
            <input name="title" defaultValue={fact.title} required className="w-full text-xs" />
          </label>
          <label className="text-xs">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Detail (optional)</span>
            <textarea name="detail" defaultValue={fact.detail ?? ""} rows={2} className="w-full text-xs" />
          </label>
          <div className="flex items-center gap-2">
            <SubmitButton className="btn primary !text-xs">Save</SubmitButton>
            <DeleteButton kind="brandFact" id={fact.id} name={fact.title} label="Delete" className="btn ghost !text-xs" />
          </div>
        </form>
      )}
      {!admin && fact.detail && <p className="mt-2 text-xs text-[var(--mute)] whitespace-pre-wrap">{fact.detail}</p>}
    </details>
  );
}

function AddFactForm({ kind, admin }: { kind: "differentiator" | "feature"; admin: boolean }) {
  if (!admin) return null;
  return (
    <form action={saveBrandFactAction} className="flex flex-col gap-2 rounded-lg bg-[var(--zebra)] px-3 py-2">
      <input type="hidden" name="kind" value={kind} />
      {kind === "feature" && (
        <input name="subject" placeholder="Product or service (optional)" className="w-full text-xs" />
      )}
      <input
        name="title"
        required
        placeholder={kind === "feature" ? "What the feature does, in one line" : "One thing a competitor can't claim"}
        className="w-full text-xs"
      />
      <textarea
        name="detail"
        rows={2}
        placeholder={
          kind === "feature"
            ? "Optional: who it's for, what it replaces, any hard limits worth respecting in copy."
            : "Optional: the proof. Concrete beats adjectives — a number, a certification, a named method."
        }
        className="w-full text-xs"
      />
      <SubmitButton className="btn !text-xs self-start">Add</SubmitButton>
    </form>
  );
}

export function BrandContextSection({
  admin,
  differentiators,
  features,
  documents,
  contextChars,
}: {
  admin: boolean;
  differentiators: BrandFact[];
  features: BrandFact[];
  documents: BrandDocument[];
  contextChars: number;
}) {
  const usable = documents.filter((d) => d.text && d.includeInContext).length;
  const broken = documents.filter((d) => d.state === "failed").length;
  const working = documents.filter((d) => d.state === "extracting").length;

  return (
    <section id="context" className="card mb-6 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
          Brand context for the AI
          <span
            className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
            style={{
              background: contextChars > 0 ? "var(--green-soft)" : "var(--zebra)",
              color: contextChars > 0 ? "var(--green-on)" : "var(--mute)",
            }}
          >
            {contextChars > 0 ? `${contextChars.toLocaleString()} chars in play` : "nothing yet"}
          </span>
        </h2>
        <p className="text-xs text-[var(--mute)]">
          What this company is and does, in its own words. Every AI feature in the workspace — blog drafts, social
          posts, SEO metadata, per-network variants, the assist buttons — is given this before it writes.
          Nothing here is AI-generated on purpose: a differentiator the model invented would then be repeated as
          fact everywhere.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---- Differentiators ---- */}
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-xs font-semibold">What makes us different</h3>
            <p className="text-[10px] text-[var(--mute)]">
              Used as the substance of any claim about the company. {differentiators.length > 1 ? ORDER_HINT : ""}
            </p>
          </div>
          {differentiators.length === 0 && (
            <p className="text-xs text-[var(--mute)] italic">
              Nothing yet — so generations describe you in generic terms, because that is all they have.
            </p>
          )}
          {differentiators.map((f, i) => (
            <FactRow key={f.id} fact={f} admin={admin} isFirst={i === 0} isLast={i === differentiators.length - 1} />
          ))}
          <AddFactForm kind="differentiator" admin={admin} />
        </div>

        {/* ---- Product / service features ---- */}
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-xs font-semibold">Products &amp; services — what each does</h3>
            <p className="text-[10px] text-[var(--mute)]">
              Copy may describe only these capabilities, and never promise one that isn&apos;t listed.
            </p>
          </div>
          {features.length === 0 && (
            <p className="text-xs text-[var(--mute)] italic">Nothing yet — add what you actually sell.</p>
          )}
          {features.map((f, i) => (
            <FactRow key={f.id} fact={f} admin={admin} isFirst={i === 0} isLast={i === features.length - 1} />
          ))}
          <AddFactForm kind="feature" admin={admin} />
        </div>
      </div>

      {/* ---- Documents ---- */}
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-xs font-semibold">
            Brand documents{" "}
            <span className="font-mono text-[10px] text-[var(--mute)]">
              {documents.length === 0
                ? "none"
                : `${usable} in context${working ? ` · ${working} being read` : ""}${broken ? ` · ${broken} unreadable` : ""}`}
            </span>
          </h3>
          <p className="text-[10px] text-[var(--mute)]">
            A positioning deck, style guide or product one-pager. Only the TEXT reaches a prompt, as background —
            never as copy to reuse verbatim. Big documents are excerpted so one can&apos;t crowd out the rest.
          </p>
        </div>

        {documents.map((d) => (
          <div key={d.id} className="rounded-lg border border-[var(--line)] px-3 py-2 flex items-start gap-2">
            <FileText className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--mute)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{d.name}</p>
              <p className="text-[10px] text-[var(--mute)]">
                {d.state === "extracting" && <>Being read now — refresh in a moment.</>}
                {d.state === "ready" && (
                  <>
                    {d.chars.toLocaleString()} characters
                    {d.storageKey ? " · uploaded file" : " · pasted text"}
                    {d.includeInContext ? "" : " · NOT sent to the AI"}
                  </>
                )}
                {d.state === "failed" && (
                  <span style={{ color: "var(--rose-on)" }}>
                    Stored, but contributing nothing: {d.extractError ?? "no text could be read."}
                  </span>
                )}
              </p>
            </div>
            {admin && (
              <div className="flex items-center gap-1 shrink-0">
                {d.state === "ready" && (
                  <form action={toggleBrandDocumentAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton className="btn ghost !text-[10px]">
                      {d.includeInContext ? "Exclude" : "Include"}
                    </SubmitButton>
                  </form>
                )}
                {d.state === "failed" && d.storageKey && (
                  <form action={retryBrandDocumentAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton className="btn ghost !text-[10px]">Try again</SubmitButton>
                  </form>
                )}
                <DeleteButton kind="brandDocument" id={d.id} name={d.name} iconOnly className="btn ghost !px-1 !py-0.5" />
              </div>
            )}
          </div>
        ))}

        {admin && (
          <form action={uploadBrandDocumentAction} className="flex flex-col gap-2 rounded-lg bg-[var(--zebra)] px-3 py-2">
            <input name="name" placeholder="Name it (optional — the filename is used otherwise)" className="w-full text-xs" />
            <label className="text-xs">
              <span className="block text-[10px] text-[var(--mute)] mb-1">
                Upload a file <span className="font-mono">({BRAND_DOC_ACCEPT}, up to {BRAND_DOC_MAX_BYTES / 1024 / 1024}MB)</span>
              </span>
              <input type="file" name="file" accept={BRAND_DOC_ACCEPT} className="w-full text-xs" />
            </label>
            <label className="text-xs">
              <span className="block text-[10px] text-[var(--mute)] mb-1">
                …or paste the text — the reliable route for any format, and the only one for slides
              </span>
              <textarea name="pastedText" rows={3} placeholder="Paste your positioning, boilerplate, style notes…" className="w-full text-xs" />
            </label>
            <SubmitButton className="btn !text-xs self-start" pendingText="Reading…">Add document</SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}
