"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Link2, Link2Off, List, ListOrdered, Quote, Redo2, RemoveFormatting, Underline, Undo2,
} from "lucide-react";
import { plainTextToRichHtml, looksLikeHtml, richTextToPlainText } from "@/lib/richtext";

/**
 * A traditional WYSIWYG editor: one writing surface, a formatting toolbar, and
 * what you see is what gets saved.
 *
 * ⚠ THE SURFACE IS UNCONTROLLED, AND THAT IS NOT LAZINESS. A contentEditable
 * whose innerHTML is written from React state on every keystroke moves the
 * caret to the end of the document as you type — the classic rich-text bug.
 * So the HTML is rendered ONCE (server-side, from a captured seed), the DOM
 * owns it afterwards, and the parent is notified through `onChange`. To load
 * different content, change the component's `key` so it remounts; never push
 * new HTML into a live surface.
 *
 * ⚠ `document.execCommand` is deprecated and still the only thing every browser
 * implements for this. The replacement (a Selection/Range engine per command)
 * is a library's worth of work and a library is what this codebase avoids. It
 * is used deliberately, with the DOM as the source of truth afterwards.
 *
 * ⚠ Paste is intercepted and sanitized. Pasting from Word or a WordPress editor
 * otherwise drags in font tags, MSO comments and style attributes that then get
 * stored and published.
 */
export function RichTextEditor({
  name,
  initialHtml,
  initialText,
  plainName,
  disabled,
  placeholder,
  minHeight = 200,
  onChange,
}: {
  /** Hidden field carrying the HTML. */
  name: string;
  initialHtml: string | null;
  /** Fallback for content written before the editor existed. */
  initialText?: string;
  /** Optional second hidden field carrying the plain-text projection. */
  plainName?: string;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
  onChange?: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>(() => {
    const seed = (initialHtml ?? "").trim();
    if (seed) return seed;
    const text = (initialText ?? "").trim();
    if (!text) return "";
    return looksLikeHtml(text) ? text : plainTextToRichHtml(text);
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);
  const plainRef = useRef<HTMLTextAreaElement>(null);
  const lastPlain = useRef<string>("");

  /**
   * ⚠ The initial HTML is rendered by the SERVER, not injected by an effect.
   * An effect-only version showed an EMPTY editor until hydration finished —
   * and stayed empty if the client bundle never ran, while a hidden field held
   * the real article. An author looking at an empty box retypes their work.
   *
   * `seed` is captured once and never changes, so React sees the same
   * `__html` on every render and leaves the live DOM alone — which is what
   * keeps the surface uncontrolled and the caret still.
   */
  const seed = useRef(html).current;

  // Keep the plain projection in step, through the prototype setter so React's
  // _valueTracker doesn't swallow it…
  useEffect(() => {
    const el = plainRef.current;
    if (!el) return;
    const text = richTextToPlainText(html);
    lastPlain.current = text;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, text);
  }, [html]);

  // …and adopt what AiAssist writes into it, so accepting a draft lands in the
  // surface the author is actually looking at.
  useEffect(() => {
    const el = plainRef.current;
    if (!el) return;
    const onInput = () => {
      const v = el.value;
      if (v === lastPlain.current) return; // our own write, echoed back
      lastPlain.current = v;
      const asHtml = looksLikeHtml(v) ? v : plainTextToRichHtml(v);
      if (ref.current) ref.current.innerHTML = asHtml;
      setHtml(asHtml);
      onChange?.(asHtml);
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [onChange]);

  const sync = useCallback(() => {
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    onChange?.(next);
  }, [onChange]);

  const exec = useCallback(
    (command: string, value?: string) => {
      if (disabled) return;
      ref.current?.focus();
      if (savedRange.current) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(savedRange.current);
      }
      document.execCommand(command, false, value);
      sync();
    },
    [disabled, sync],
  );

  /** Remember where the caret was — clicking a toolbar button drops selection. */
  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const clipboardHtml = e.clipboardData.getData("text/html");
    const clipboardText = e.clipboardData.getData("text/plain");
    if (clipboardHtml) {
      // Sanitize with the DOM here; the server sanitizes again on save.
      const doc = new DOMParser().parseFromString(clipboardHtml, "text/html");
      doc.querySelectorAll("script,style,meta,link,iframe,object,embed").forEach((n) => n.remove());
      doc.querySelectorAll("*").forEach((el) => {
        for (const attr of [...el.attributes]) {
          if (attr.name !== "href" && attr.name !== "src" && attr.name !== "alt") el.removeAttribute(attr.name);
        }
      });
      document.execCommand("insertHTML", false, doc.body.innerHTML);
    } else {
      document.execCommand("insertText", false, clipboardText);
    }
    sync();
  }

  function applyLink() {
    const url = linkUrl.trim();
    setLinkOpen(false);
    setLinkUrl("");
    if (!url) return;
    // Refuse a script URL outright rather than storing one for the sanitizer
    // to quietly drop later — the author should see that it didn't take.
    if (/^\s*(javascript|vbscript|data):/i.test(url)) return;
    const href = /^(https?:|mailto:|tel:|#|\/)/i.test(url) ? url : `https://${url}`;
    exec("createLink", href);
  }

  const words = richTextToPlainText(html).split(/\s+/).filter(Boolean).length;

  const Tool = ({
    onClick, title, children, active,
  }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); remember(); }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="btn ghost !px-1.5 !py-1"
      style={active ? { background: "var(--violet-soft)", color: "var(--violet-on)" } : undefined}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name={name} value={html} readOnly />
      {/* ⚠ The plain field is UNCONTROLLED and hidden rather than `type=hidden`:
          AiAssist finds its target by `name`, writes the accepted draft into it
          and dispatches `input`. We push our projection into it, and adopt
          anything written from outside — otherwise "Use it" would update a
          field nobody can see while the writing surface ignored it. */}
      {plainName && (
        // ⚠ A TEXTAREA, not an <input>: an input's value cannot contain line
        // breaks, so the projection arrived at the server as one run-on line —
        // which is what the no-JS fallback would then store as the grounding.
        <textarea ref={plainRef} name={plainName} defaultValue={richTextToPlainText(html)} hidden readOnly aria-hidden tabIndex={-1} />
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--line)] px-1 py-1">
          <select
            onMouseDown={remember}
            onChange={(e) => { exec("formatBlock", e.target.value); e.target.selectedIndex = 0; }}
            disabled={disabled}
            className="text-xs !py-0.5"
            aria-label="Text style"
            defaultValue=""
          >
            <option value="" disabled>Style</option>
            <option value="p">Paragraph</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
          </select>
          <Tool onClick={() => exec("bold")} title="Bold"><Bold className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("italic")} title="Italic"><Italic className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("underline")} title="Underline"><Underline className="w-3.5 h-3.5" /></Tool>
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool onClick={() => exec("insertUnorderedList")} title="Bulleted list"><List className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("insertOrderedList")} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("formatBlock", "blockquote")} title="Quote"><Quote className="w-3.5 h-3.5" /></Tool>
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool onClick={() => { remember(); setLinkOpen((v) => !v); }} title="Insert link" active={linkOpen}>
            <Link2 className="w-3.5 h-3.5" />
          </Tool>
          <Tool onClick={() => exec("unlink")} title="Remove link"><Link2Off className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("removeFormat")} title="Clear formatting"><RemoveFormatting className="w-3.5 h-3.5" /></Tool>
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool onClick={() => exec("undo")} title="Undo"><Undo2 className="w-3.5 h-3.5" /></Tool>
          <Tool onClick={() => exec("redo")} title="Redo"><Redo2 className="w-3.5 h-3.5" /></Tool>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-[var(--mute)] px-1">{words.toLocaleString()} words</span>
        </div>
      )}

      {linkOpen && !disabled && (
        <div className="flex items-center gap-1">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
            placeholder="https://example.com — select text first, then paste the URL"
            className="flex-1 text-xs"
            autoFocus
          />
          <button type="button" onClick={applyLink} className="btn !text-xs">Link</button>
          <button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); }} className="btn ghost !text-xs">Cancel</button>
        </div>
      )}

      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={sync}
        onBlur={() => { remember(); sync(); }}
        onKeyUp={remember}
        onMouseUp={remember}
        onPaste={onPaste}
        dangerouslySetInnerHTML={{ __html: seed }}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text editor"
        className="rich-surface w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm leading-relaxed overflow-y-auto focus:outline-none [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h3]:font-semibold [&_h3]:mt-2 [&_h4]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_img]:max-w-full [&_table]:w-full [&_td]:border [&_td]:border-[var(--line)] [&_td]:px-1 [&_th]:border [&_th]:border-[var(--line)] [&_th]:px-1"
        style={{ minHeight, maxHeight: 560 }}
      />
    </div>
  );
}
