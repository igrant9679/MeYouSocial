"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bold, ImagePlus, Italic, Link2, Link2Off, List, ListOrdered, Quote, Redo2, RemoveFormatting, Table, Underline, Undo2,
} from "lucide-react";
import { plainTextToRichHtml, looksLikeHtml, richTextToPlainText } from "@/lib/richtext";
import { stripExecutableHtml } from "@/lib/html-safety";
import { blankTableHtml, looksLikeMarkdown, markdownToHtml } from "@/lib/markdown-paste";

/**
 * The article editor's extras (E-ART-18): images from the article and the
 * workspace's media, the site's own articles to link to, a table, Markdown
 * paste and keyboard shortcuts. Description fields don't get them.
 */
export type EditorExtras = {
  media: Array<{ url: string; alt: string | null; label: string }>;
  links: Array<{ title: string; url: string }>;
};

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * A traditional WYSIWYG editor: one writing surface, a formatting toolbar, and
 * what you see is what gets saved.
 *
 * ⚠ THE SURFACE IS UNCONTROLLED, AND KEEPING IT THAT WAY TOOK A `memo` THAT
 * NEVER RE-RENDERS. A contentEditable whose innerHTML comes from React state
 * fights the user: the caret jumps, or worse.
 *
 * The first cut rendered the seed with `dangerouslySetInnerHTML` and assumed an
 * unchanged `__html` string meant React would leave the DOM alone. It does not.
 * Every keystroke ran onInput → setHtml → re-render, and the re-render RESTORED
 * THE SEED OVER WHAT THE USER HAD JUST TYPED. On production, in real Chrome,
 * that read exactly as the owner reported it: "even when I delete the text and
 * paste the new one, it's not making changes" — their words reverted on screen
 * and the hidden field trailed one edit behind, so saving stored the old copy.
 *
 * So the editable element lives in `Surface`, memoised with a comparator that
 * ALWAYS returns true: after mount React never touches it again, and the DOM
 * belongs to the person typing. Handlers reach it through a ref, because a memo
 * that never re-renders would otherwise hold the first render's closures. To
 * load different content, change the component's `key` so it remounts; never
 * push new HTML into a live surface.
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
/**
 * The editable element, isolated so React can never re-render it.
 *
 * ⚠ The comparator returns TRUE unconditionally — "nothing ever changed" — which
 * is the whole point: after mount the DOM inside belongs to the person typing,
 * and any re-render would restore `seed` over their words. `disabled` and the
 * other props cannot change without a page load, so freezing them costs
 * nothing. Handlers arrive through a ref because a component that never
 * re-renders would otherwise be stuck with the first render's closures.
 */
const Surface = memo(
  function Surface({
    innerRef, editable, seed, placeholder, minHeight, handlers,
  }: {
    innerRef: React.RefObject<HTMLDivElement | null>;
    editable: boolean;
    seed: string;
    placeholder?: string;
    minHeight: number;
    handlers: React.RefObject<{ sync: () => void; remember: () => void; onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void; onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void }>;
  }) {
    return (
      <div
        ref={innerRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={() => handlers.current?.sync()}
        onBlur={() => { handlers.current?.remember(); handlers.current?.sync(); }}
        onKeyUp={() => handlers.current?.remember()}
        onMouseUp={() => handlers.current?.remember()}
        onPaste={(e) => handlers.current?.onPaste(e)}
        onKeyDown={(e) => handlers.current?.onKeyDown(e)}
        dangerouslySetInnerHTML={{ __html: seed }}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text editor"
        className="rich-surface w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm leading-relaxed overflow-y-auto focus:outline-none [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h3]:font-semibold [&_h3]:mt-2 [&_h4]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_img]:max-w-full [&_table]:w-full [&_td]:border [&_td]:border-[var(--line)] [&_td]:px-1 [&_th]:border [&_th]:border-[var(--line)] [&_th]:px-1"
        style={{ minHeight, maxHeight: 560 }}
      />
    );
  },
  () => true,
);

export function RichTextEditor({
  name,
  initialHtml,
  initialText,
  plainName,
  disabled,
  placeholder,
  minHeight = 200,
  onChange,
  extras,
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
  /** E-ART-18: the article editor's media, links, table, Markdown paste and shortcuts. */
  extras?: EditorExtras;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // ⚠ The seed is mounted as live HTML, so it is stripped of anything
  // executable first — on the server render and in the browser alike (pure
  // string work, identical output, no hydration mismatch). Stored bodies from
  // before the save-time check, or from any other writer, can't run here.
  const [html, setHtml] = useState<string>(() => {
    const seed = (initialHtml ?? "").trim();
    if (seed) return stripExecutableHtml(seed);
    const text = (initialText ?? "").trim();
    if (!text) return "";
    return looksLikeHtml(text) ? stripExecutableHtml(text) : plainTextToRichHtml(text);
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
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
  const [seed] = useState(html);

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
    if (!clipboardHtml && extras && looksLikeMarkdown(clipboardText)) {
      // Markdown from a chat window or a notes app arrives formatted (E-ART-18).
      document.execCommand("insertHTML", false, stripExecutableHtml(markdownToHtml(clipboardText)));
    } else if (clipboardHtml) {
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

  /**
   * The article editor's shortcuts (E-ART-18): Ctrl/⌘+K a link, Ctrl/⌘+Alt+2,
   * 3, 4 a heading and 0 a paragraph, Ctrl/⌘+Shift+7 and 8 the lists. Bold,
   * italic and underline are the browser's own. ⚠ Ctrl/⌘+K is stopped here so
   * the app's search (it listens on window) stays shut while you write.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!extras || disabled || !(e.ctrlKey || e.metaKey)) return;
    const take = (run: () => void) => { e.preventDefault(); e.stopPropagation(); remember(); run(); };
    if (!e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") return take(() => setLinkOpen(true));
    if (e.altKey && !e.shiftKey) {
      const block = ({ Digit2: "h2", Digit3: "h3", Digit4: "h4", Digit0: "p" } as Record<string, string>)[e.code];
      if (block) return take(() => exec("formatBlock", block));
    }
    if (e.shiftKey && !e.altKey) {
      if (e.code === "Digit7") return take(() => exec("insertOrderedList"));
      if (e.code === "Digit8") return take(() => exec("insertUnorderedList"));
    }
  }

  function insertImage(m: EditorExtras["media"][number]) {
    setImageOpen(false);
    exec("insertHTML", `<img src="${attr(m.url)}" alt="${attr(m.alt ?? "")}">`);
  }

  // Surface never re-renders, so it reads its handlers from here instead of
  // from the closure it mounted with.
  const handlersRef = useRef({ sync, remember, onPaste, onKeyDown });
  useLayoutEffect(() => {
    handlersRef.current = { sync, remember, onPaste, onKeyDown };
  });

  const words = richTextToPlainText(html).split(/\s+/).filter(Boolean).length;

  // Toolbar buttons keep the selection (remember) and follow `disabled`.
  const toolProps = { onRemember: remember, disabled };

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
          <Tool {...toolProps} onClick={() => exec("bold")} title="Bold"><Bold className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("italic")} title="Italic"><Italic className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("underline")} title="Underline"><Underline className="w-3.5 h-3.5" /></Tool>
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool {...toolProps} onClick={() => exec("insertUnorderedList")} title="Bulleted list"><List className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("insertOrderedList")} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("formatBlock", "blockquote")} title="Quote"><Quote className="w-3.5 h-3.5" /></Tool>
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool {...toolProps} onClick={() => { remember(); setLinkOpen((v) => !v); }} title={extras ? "Insert link (Ctrl+K)" : "Insert link"} active={linkOpen}>
            <Link2 className="w-3.5 h-3.5" />
          </Tool>
          <Tool {...toolProps} onClick={() => exec("unlink")} title="Remove link"><Link2Off className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("removeFormat")} title="Clear formatting"><RemoveFormatting className="w-3.5 h-3.5" /></Tool>
          {extras && (
            <>
              <span className="w-px h-4 bg-[var(--line)] mx-1" />
              <Tool {...toolProps} onClick={() => { remember(); setImageOpen((v) => !v); }} title="Insert an image from this article or the media library" active={imageOpen}><ImagePlus className="w-3.5 h-3.5" /></Tool>
              <Tool {...toolProps} onClick={() => exec("insertHTML", blankTableHtml())} title="Insert a table"><Table className="w-3.5 h-3.5" /></Tool>
            </>
          )}
          <span className="w-px h-4 bg-[var(--line)] mx-1" />
          <Tool {...toolProps} onClick={() => exec("undo")} title="Undo"><Undo2 className="w-3.5 h-3.5" /></Tool>
          <Tool {...toolProps} onClick={() => exec("redo")} title="Redo"><Redo2 className="w-3.5 h-3.5" /></Tool>
          <span className="flex-1" />
          {/* suppressHydrationWarning: viewer-locale number grouping differs
              from the server's — intended, and a React #418 without this
              (audit A2; the rule is documented in BlogBodyEditor.tsx). */}
          <span className="font-mono text-[10px] text-[var(--mute)] px-1" suppressHydrationWarning>{words.toLocaleString()} words</span>
        </div>
      )}

      {imageOpen && extras && !disabled && (
        <div className="rounded-lg border border-[var(--line)] p-2" data-image-picker>
          {extras.media.length === 0 ? (
            <p className="text-xs text-[var(--mute)] m-0">No images yet — generate or attach them on the Assets tab, or upload to Media.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {extras.media.map((m) => (
                <button key={m.url} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertImage(m)} className="w-24 text-left" title={m.alt ?? m.label} data-insert-image={m.url}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt ?? ""} className="w-24 h-16 object-cover rounded border border-[var(--line)]" />
                  <span className="block text-[10px] text-[var(--mute)] truncate">{m.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {linkOpen && !disabled && (
        <div className="flex items-center gap-1 flex-wrap">
          {extras && extras.links.length > 0 && (
            <select
              onChange={(e) => { if (e.target.value) setLinkUrl(e.target.value); }}
              defaultValue=""
              className="text-xs max-w-64"
              aria-label="Link to one of your articles"
              data-internal-links
            >
              <option value="">One of your articles…</option>
              {extras.links.map((l) => <option key={l.url} value={l.url}>{l.title}</option>)}
            </select>
          )}
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

      <Surface
        innerRef={ref}
        editable={!disabled}
        seed={seed}
        placeholder={placeholder}
        minHeight={minHeight}
        handlers={handlersRef}
      />
    </div>
  );
}

/** A toolbar button. Module-level so React keeps the same button between renders (PRF-04). */
function Tool({
  onClick, onRemember, disabled, title, children, active,
}: { onClick: () => void; onRemember: () => void; disabled?: boolean; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onRemember(); }}
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
}
