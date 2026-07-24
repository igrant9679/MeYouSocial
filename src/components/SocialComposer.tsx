"use client";

import { useMemo, useRef, useState } from "react";
import { Send, CalendarClock, ImagePlus, X, Pencil, RotateCcw, Tags, Plus } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { createSocialPostAction } from "@/app/actions/social";
import { networkFor } from "@/lib/social/networks";

export type ComposerAccount = { id: string; provider: string; name: string | null };
export type ComposerTopic = { id: string; name: string; keywords: string[] };

// Buffer/Hootsuite-style composer: pick accounts, write a base post once, then
// optionally customize text AND images per network. Each network shows its own
// live character count against its own limit.

/** Rewrite a file input's FileList so removing a chip actually drops the upload. */
function syncInput(input: HTMLInputElement | null, files: File[]) {
  if (!input) return;
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
}

export function SocialComposer({ accounts, topics = [] }: { accounts: ComposerAccount[]; topics?: ComposerTopic[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(accounts.length === 1 ? [accounts[0].id] : []));
  const [text, setText] = useState("");
  const [topicId, setTopicId] = useState("");
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [customizing, setCustomizing] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [files, setFiles] = useState<File[]>([]);
  const [variantFiles, setVariantFiles] = useState<Record<string, File[]>>({});

  const baseInput = useRef<HTMLInputElement>(null);
  const variantInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Distinct providers among the selected accounts — one customization row each.
  const selectedProviders = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) if (selected.has(a.id)) set.add(a.provider.toUpperCase());
    return [...set];
  }, [accounts, selected]);

  // What a network will actually post — its override when customizing and
  // non-empty, else the base. Mirrors the server's fallback exactly.
  const effectiveText = (p: string) =>
    customizing.has(p) && (variants[p] ?? "").trim() ? variants[p] : text;
  const effectiveMedia = (p: string) =>
    customizing.has(p) && (variantFiles[p]?.length ?? 0) > 0 ? variantFiles[p] : files;

  const anyOver = selectedProviders.some((p) => effectiveText(p).length > (networkFor(p)?.charLimit ?? 3000));
  const topic = topics.find((t) => t.id === topicId);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleCustom = (provider: string) =>
    setCustomizing((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
        setVariants((v) => { const c = { ...v }; delete c[provider]; return c; });
        setVariantFiles((v) => { const c = { ...v }; delete c[provider]; return c; });
        syncInput(variantInputs.current[provider], []);
      } else {
        next.add(provider);
        setVariants((v) => ({ ...v, [provider]: text })); // seed from base
      }
      return next;
    });

  if (accounts.length === 0) {
    return (
      <div className="card mb-6 text-sm text-[var(--mute)]">
        No social accounts connected yet. Connect LinkedIn, Instagram or X under{" "}
        <a href="/admin/connections" className="underline" style={{ color: "var(--accent)" }}>Admin → Connections</a> to start posting.
      </div>
    );
  }

  return (
    <form action={createSocialPostAction} className="card mb-6 flex flex-col gap-3" encType="multipart/form-data">
      {/* Account picker */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1.5">Post to</div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const net = networkFor(a.provider);
            const on = selected.has(a.id);
            return (
              <label key={a.id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs font-semibold transition-colors"
                style={on ? { borderColor: net?.color ?? "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)" } : { borderColor: "var(--line-2)" }}>
                <input type="checkbox" name="accountIds" value={a.id} checked={on} onChange={() => toggle(a.id)} className="sr-only" />
                <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                {net?.label ?? a.provider}
                <span className="text-[var(--mute)] font-normal truncate max-w-[140px]">{a.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Topic — optional, ties the post to a workspace theme */}
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs">
            <Tags className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Topic</span>
            <select name="topicId" value={topicId} onChange={(e) => setTopicId(e.target.value)}
              className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
              <option value="">— none —</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {/* That topic's related phrases, click to insert */}
          {topic?.keywords.map((k) => (
            <button key={k} type="button" title="Insert into the post"
              onClick={() => setText((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${k}` : k))}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]">
              <Plus className="w-2.5 h-2.5" /> {k}
            </button>
          ))}
        </div>
      )}

      {/* Base composer */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">
          {selectedProviders.length > 1 ? "Base post (used by any network you don’t customize)" : "Text"}
        </div>
        <textarea
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="What do you want to share?"
          className="w-full border border-[var(--line-2)] rounded-lg p-2.5 text-sm resize-y"
        />
        {/* Base media */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <label className="btn sm cursor-pointer">
            <ImagePlus className="w-4 h-4" /> Add image
            <input ref={baseInput} type="file" name="media" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))} />
          </label>
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg" style={{ background: "var(--panel)" }}>
              {f.name.slice(0, 20)}
              <button type="button" aria-label={`Remove ${f.name}`}
                onClick={() => { const next = files.filter((_, j) => j !== i); setFiles(next); syncInput(baseInput.current, next); }}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Per-network customization + live counts */}
      {selectedProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          {selectedProviders.map((p) => {
            const net = networkFor(p);
            const limit = net?.charLimit ?? 3000;
            const isCustom = customizing.has(p);
            const eff = effectiveText(p);
            const over = eff.length > limit;
            const media = effectiveMedia(p);
            const vFiles = variantFiles[p] ?? [];
            return (
              <div key={p} className="rounded-lg border border-[var(--line)] p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                  <span className="text-xs font-semibold">{net?.label ?? p}</span>
                  <span className="font-mono text-[11px]" style={{ color: over ? "var(--rose-on)" : "var(--mute)" }}>
                    {eff.length}/{limit}{over ? " — over limit" : ""}
                  </span>
                  {media.length > 0 && (
                    <span className="font-mono text-[10px] text-[var(--mute)]">
                      {media.length} image{media.length > 1 ? "s" : ""}{isCustom && vFiles.length > 0 ? " (own)" : ""}
                    </span>
                  )}
                  {net?.requiresMedia && media.length === 0 && <span className="text-[11px] text-[var(--amber-on)]">needs an image</span>}
                  <span className="flex-1" />
                  <button type="button" onClick={() => toggleCustom(p)} className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                    {isCustom ? <><RotateCcw className="w-3 h-3" /> Use base</> : <><Pencil className="w-3 h-3" /> Customize</>}
                  </button>
                </div>
                {isCustom && (
                  <>
                    <textarea
                      name={`variant_${p}`}
                      value={variants[p] ?? ""}
                      onChange={(e) => setVariants((v) => ({ ...v, [p]: e.target.value }))}
                      rows={3}
                      placeholder={`Text just for ${net?.label ?? p}…`}
                      className="w-full border border-[var(--line-2)] rounded-lg p-2 text-sm mt-2 resize-y"
                    />
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <label className="btn sm cursor-pointer">
                        <ImagePlus className="w-4 h-4" /> Image for {net?.label ?? p}
                        <input
                          ref={(el) => { variantInputs.current[p] = el; }}
                          type="file" name={`media_${p}`} accept="image/png,image/jpeg,image/gif,image/webp" multiple className="sr-only"
                          onChange={(e) => setVariantFiles((v) => ({ ...v, [p]: Array.from(e.target.files ?? []).slice(0, 4) }))}
                        />
                      </label>
                      {vFiles.length === 0 && <span className="text-[11px] text-[var(--mute)]">using the base image{files.length === 1 ? "" : "s"}</span>}
                      {vFiles.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg" style={{ background: "var(--panel)" }}>
                          {f.name.slice(0, 20)}
                          <button type="button" aria-label={`Remove ${f.name}`}
                            onClick={() => { const next = vFiles.filter((_, j) => j !== i); setVariantFiles((v) => ({ ...v, [p]: next })); syncInput(variantInputs.current[p], next); }}>
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Schedule + submit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
        <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} /> Post now
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="when" value="schedule" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> Schedule
        </label>
        {when === "schedule" && (
          <input type="datetime-local" name="scheduledAt" className="border border-[var(--line-2)] rounded-lg p-1.5 text-sm font-mono" />
        )}
        <span className="flex-1" />
        <SubmitButton className="btn primary" disabled={selected.size === 0 || anyOver} pendingText={when === "schedule" ? "Scheduling…" : "Posting…"}>
          {when === "schedule" ? <><CalendarClock className="w-4 h-4" /> Schedule</> : <><Send className="w-4 h-4" /> Post now</>}
        </SubmitButton>
      </div>
    </form>
  );
}
