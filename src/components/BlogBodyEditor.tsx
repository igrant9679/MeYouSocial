"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, Eye, PencilLine } from "lucide-react";
import { autosaveBlogBodyAction } from "@/app/actions/blog";
import { RichTextEditor } from "@/components/RichTextEditor";

/**
 * Blog body editor: a WYSIWYG surface, the HTML source, and a rendered preview,
 * plus live word count / reading time and debounced autosave (3s idle). The
 * field is named "body" so the surrounding form's explicit Save still works and
 * creates a version; autosave writes body only (no version churn).
 *
 * ⚠ HTML IS THE STORED FORM AND THE EDITOR EDITS IT DIRECTLY. `BlogPost.body`
 * is what publishCore sends to WordPress, what the HTML export embeds and what
 * the checks read — so rich text here is not a conversion layer, it is that
 * same HTML with a toolbar over it. Nothing is transformed on the way in or
 * out, and an article nobody edits stays byte-identical.
 *
 * ⚠ The rich surface is REMOUNTED BY KEY when you come back to it from HTML.
 * It is uncontrolled by design — a contentEditable rewritten from state moves
 * the caret to the end on every keystroke — so a fresh mount is the only safe
 * way to load edits made in the other tab.
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

type Mode = "rich" | "source" | "preview";

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
  const [mode, setMode] = useState<Mode>("rich");
  const [mountKey, setMountKey] = useState(0);
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

  function toMode(next: Mode) {
    // Coming back to the surface, remount it so it picks up edits made in the
    // HTML tab. See the key warning above.
    if (next === "rich" && mode !== "rich") setMountKey((k) => k + 1);
    setMode(next);
  }

  const tab = (m: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => toMode(m)}
      className="btn"
      aria-pressed={mode === m}
      style={mode === m ? { background: "var(--violet-soft)", color: "var(--violet-on)" } : undefined}
    >
      {icon} {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="block text-xs text-[var(--mute)]">Body</span>
        <span className="font-mono text-[10px] text-[var(--mute)]">
          {words.toLocaleString()} words · ~{minutes} min read
          {saveState === "pending" && " · saving…"}
          {saveState === "saved" && " · autosaved"}
        </span>
        <span className="flex-1" />
        {tab("rich", "Edit", <PencilLine className="w-3.5 h-3.5" />)}
        {tab("source", "HTML", <Code2 className="w-3.5 h-3.5" />)}
        {tab("preview", "Preview", <Eye className="w-3.5 h-3.5" />)}
      </div>

      {mode === "preview" && (
        <div
          className="rounded-lg border border-[var(--line)] p-4 text-sm leading-relaxed max-h-[480px] overflow-y-auto [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h3]:font-semibold [&_h3]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: sanitize(body) || "<p style='color:var(--mute)'>Nothing to preview yet.</p>" }}
        />
      )}

      {mode === "rich" && (
        <RichTextEditor
          key={mountKey}
          name="body"
          initialHtml={body}
          disabled={disabled}
          minHeight={380}
          placeholder="Write here, or generate a grounded AI draft below."
          onChange={setBody}
        />
      )}

      {mode === "source" && (
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
      {/* Preview has no field of its own, so the form still needs the body. */}
      {mode === "preview" && <input type="hidden" name="body" value={body} />}
    </div>
  );
}
