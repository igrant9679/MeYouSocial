"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 *
 * ⚠ THE STORED BODY CAN CHANGE UNDER AN OPEN EDITOR (ART-01/03): Regenerate,
 * section rewrites, Restore, auto-review, applied findings and Inbox Verify all
 * write it server-side. `serverHash` is the hash of the stored body this render
 * saw, and every save sends the hash it started from (`baseHash`), so the server
 * refuses to put old text back over new. Here: with nothing unsaved, a new
 * stored body is simply loaded; with unsaved typing, the person is told and
 * chooses — their text is already kept under Versions by the refused save.
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
type SaveState = "idle" | "pending" | "saved" | "failed" | "conflict";

export function BlogBodyEditor({
  postId,
  initialBody,
  serverHash,
  disabled,
}: {
  postId: string;
  initialBody: string;
  /** Hash of the stored body this render was made from (lib/blog-gates bodyHash). */
  serverHash: string;
  disabled?: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  const [mode, setMode] = useState<Mode>("rich");
  const [mountKey, setMountKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // The stored body this editor's text is based on. Moves on every save that lands.
  const [baseHash, setBaseHash] = useState(serverHash);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);
  const latest = useRef({ body, baseHash, saveState });
  // Updated after each render, before any handler or effect reads it.
  useLayoutEffect(() => {
    latest.current = { body, baseHash, saveState };
  });
  const formAnchor = useRef<HTMLInputElement>(null);

  const words = useMemo(() => {
    const text = body.replace(/<[^>]+>/g, " ").trim();
    return text ? text.split(/\s+/).length : 0;
  }, [body]);
  const minutes = Math.max(1, Math.round(words / 220));

  /** Load a body as the new starting point (rich surface remounted to show it). */
  function adopt(next: string, hash: string) {
    setBody(next);
    lastSaved.current = next;
    setBaseHash(hash);
    setMountKey((k) => k + 1);
    setSaveState("idle");
  }

  // A different stored body arrived with a fresh render. Nothing unsaved → load
  // it (it's either another writer's text or our own Save, normalised). Unsaved
  // typing → don't touch it; the next save meets the conflict and says so.
  useEffect(() => {
    if (serverHash === latest.current.baseHash) return;
    if (latest.current.body === lastSaved.current) adopt(initialBody, serverHash);
    else setSaveState("conflict");
    // Only a new server hash means anything here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverHash]);

  async function save(text: string, base: string, force = false): Promise<void> {
    const fd = new FormData();
    fd.set("id", postId);
    fd.set("body", text);
    if (!force) fd.set("baseHash", base);
    try {
      const res = await autosaveBlogBodyAction(fd);
      if (res?.ok) {
        lastSaved.current = text;
        setBaseHash(res.hash);
        setSaveState("saved");
      } else if (res?.reason === "conflict") {
        setSaveState("conflict");
      } else {
        setSaveState("failed");
      }
    } catch {
      // Said, not swallowed: the explicit Save below is the way out (ART-02).
      setSaveState("failed");
    }
  }

  useEffect(() => {
    if (disabled || body === lastSaved.current || saveState === "conflict") return;
    setSaveState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(body, baseHash);
    }, 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // save() reads its arguments; baseHash/saveState changes alone must not reschedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, postId, disabled]);

  // ⚠ The last three seconds of typing used to vanish when the editor unmounted
  // (switching editor tabs, the rail) or the tab was hidden (ART-02): flush the
  // pending save instead, and warn before the page itself is left unsaved.
  useEffect(() => {
    if (disabled) return;
    const flush = () => {
      const { body: text, baseHash: base, saveState: st } = latest.current;
      if (text === lastSaved.current || st === "conflict") return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void save(text, base);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (latest.current.body !== lastSaved.current) {
        flush();
        e.preventDefault();
      }
    };
    // The surrounding form's Save sends this text itself — no autosave behind it.
    const form = formAnchor.current?.form;
    const onSubmit = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      lastSaved.current = latest.current.body;
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    form?.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
      form?.removeEventListener("submit", onSubmit);
      flush();
    };
    // Registered once per post; the handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, disabled]);

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
      {/* The hash this text started from travels with the form's Save too. */}
      <input ref={formAnchor} type="hidden" name="baseHash" value={baseHash} />
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="block text-xs text-[var(--mute)]">Body</span>
        <span className="font-mono text-[10px] text-[var(--mute)]">
          {/* ⚠ suppressHydrationWarning is load-bearing, not decoration.
              `toLocaleString()` with no locale resolves to the CONTAINER's ICU
              default on the server (en-US on Railway) and to navigator.language
              in the browser, so a reader whose locale groups with "." or a thin
              space gets different text than the SSR HTML — React #418, and the
              whole editor tree is thrown away and re-rendered (audit A2). The
              viewer's own grouping is the behaviour we want; this tells React
              the difference is intended. Same rule at RichTextEditor.tsx,
              ScriptEditor.tsx and SocialCalendar.tsx. */}
          <span suppressHydrationWarning>{words.toLocaleString()}</span> words · ~{minutes} min read
          {saveState === "pending" && " · saving…"}
          {saveState === "saved" && " · autosaved"}
        </span>
        {saveState === "failed" && (
          <span className="font-mono text-[10px]" style={{ color: "var(--rose-on)" }}>
            · autosave failed — press Save
          </span>
        )}
        <span className="flex-1" />
        {tab("rich", "Edit", <PencilLine className="w-3.5 h-3.5" />)}
        {tab("source", "HTML", <Code2 className="w-3.5 h-3.5" />)}
        {tab("preview", "Preview", <Eye className="w-3.5 h-3.5" />)}
      </div>

      {saveState === "conflict" && (
        <div className="card mb-2 flex flex-wrap items-center gap-2 text-xs" style={{ borderColor: "var(--amber-on)" }}>
          <span className="flex-1 min-w-56">
            <b>This article changed elsewhere</b> while you were editing — the engine, Verify, a rewrite or another tab.
            Your text was <b>not</b> saved over it; it is kept under Versions as “your edit, kept”.
          </span>
          <button type="button" className="btn sm" onClick={() => window.location.reload()}>
            Load the latest
          </button>
          <button
            type="button"
            className="btn sm"
            title="Replace the newer text with yours"
            onClick={() => void save(latest.current.body, latest.current.baseHash, true)}
          >
            Keep mine
          </button>
        </div>
      )}

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
