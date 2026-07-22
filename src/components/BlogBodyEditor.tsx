"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, PencilLine } from "lucide-react";
import { autosaveBlogBodyAction } from "@/app/actions/blog";

/**
 * Blog body editor (Wave A′): HTML source + rendered preview toggle, live word
 * count / reading time, and debounced autosave (3s idle). The <textarea> is
 * named "body" so the surrounding form's explicit Save still works and creates
 * a version; autosave writes body only (no version churn).
 * Preview sanitization: scripts/iframes/event handlers stripped client-side.
 */

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,link,meta,style").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (attr.name === "src" && attr.value.startsWith("javascript:")) || (attr.name === "href" && attr.value.trim().toLowerCase().startsWith("javascript:"))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

export function BlogBodyEditor({
  postId,
  initialBody,
  disabled,
}: {
  postId: string;
  initialBody: string;
  disabled?: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);

  const words = useMemo(() => {
    const text = body.replace(/<[^>]+>/g, " ").trim();
    return text ? text.split(/\s+/).length : 0;
  }, [body]);
  const minutes = Math.max(1, Math.round(words / 220));

  useEffect(() => {
    if (disabled || body === lastSaved.current) return;
    setSaveState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const fd = new FormData();
        fd.set("id", postId);
        fd.set("body", body);
        await autosaveBlogBodyAction(fd);
        lastSaved.current = body;
        setSaveState("saved");
      } catch {
        setSaveState("idle"); // explicit Save remains the fallback
      }
    }, 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body, postId, disabled]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="block text-xs text-[var(--mute)]">Body (HTML)</span>
        <span className="font-mono text-[10px] text-[var(--mute)]">
          {words.toLocaleString()} words · ~{minutes} min read
          {saveState === "pending" && " · saving…"}
          {saveState === "saved" && " · autosaved"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="btn"
          aria-pressed={preview}
        >
          {preview ? <><PencilLine className="w-3.5 h-3.5" /> Edit</> : <><Eye className="w-3.5 h-3.5" /> Preview</>}
        </button>
      </div>

      {preview ? (
        <div
          className="rounded-lg border border-[var(--line)] p-4 text-sm leading-relaxed max-h-[480px] overflow-y-auto [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h3]:font-semibold [&_h3]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: sanitize(body) || "<p style='color:var(--mute)'>Nothing to preview yet.</p>" }}
        />
      ) : (
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          placeholder="Write here, or generate a grounded AI draft below."
          className="w-full font-mono text-xs leading-relaxed"
          disabled={disabled}
        />
      )}
      {preview && <input type="hidden" name="body" value={body} />}
    </div>
  );
}
