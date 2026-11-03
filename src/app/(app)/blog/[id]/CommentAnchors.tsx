"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { addBlogCommentAction } from "@/app/actions/blog-review";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Anchored review comments (E-ART-15), the browser half: the article's text
 * with each open comment's passage marked, a "Comment on this" bar for the
 * words someone selects, and a comment box that completes @mentions.
 *
 * ⚠ The marks are DOM-only — added after React sets the HTML and never sent
 * anywhere, so the stored body, the export and WordPress never see them.
 */

export type AnchorMark = { id: string; text: string };
export type MentionOption = { userId: string; label: string; insert: string; handles: string[] };

const MAX_ANCHOR = 300;
const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|TABLE|TR|TD|TH|PRE|SECTION|ARTICLE|FIGURE|FIGCAPTION|BR|HR)$/;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Cut a long selection on a word, so the quote stays a run of the article's own words. */
function clipQuote(s: string): string {
  const q = squash(s);
  if (q.length <= MAX_ANCHOR) return q;
  const cut = q.slice(0, MAX_ANCHOR);
  const sp = cut.lastIndexOf(" ");
  return sp > MAX_ANCHOR * 0.6 ? cut.slice(0, sp) : cut;
}

function blockOf(n: Node, root: HTMLElement): Node {
  let p: Node | null = n.parentNode;
  while (p && p !== root && !(p instanceof HTMLElement && BLOCK.test(p.tagName))) p = p.parentNode;
  return p ?? root;
}

/**
 * Wrap the first occurrence of `quote` in <mark>s. Text is compared with
 * whitespace collapsed, case folded, and a word break at each block boundary —
 * the way lib/comment-anchors.ts articleText reads the stored HTML.
 */
function markQuote(root: HTMLElement, quote: string, id: string): boolean {
  const target = squash(quote).toLowerCase();
  if (!target) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let flat = "";
  const map: Array<{ node: Text; offset: number } | null> = [];
  let lastBlock: Node | null = null;
  let pendingSpace = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const block = blockOf(t, root);
    if (lastBlock && block !== lastBlock) pendingSpace = true;
    lastBlock = block;
    const s = t.data;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (/\s/.test(ch)) { pendingSpace = true; continue; }
      if (pendingSpace && flat.length) { flat += " "; map.push(null); }
      pendingSpace = false;
      flat += ch.toLowerCase();
      map.push({ node: t, offset: i });
    }
  }
  const at = flat.indexOf(target);
  if (at < 0) return false;
  // Gather [start, end) per text node.
  const spans = new Map<Text, { start: number; end: number }>();
  for (let i = at; i < at + target.length; i++) {
    const m = map[i];
    if (!m) continue;
    const cur = spans.get(m.node);
    if (cur) cur.end = m.offset + 1;
    else spans.set(m.node, { start: m.offset, end: m.offset + 1 });
  }
  // Last first, so splitting one node never moves another's offsets.
  const entries = [...spans.entries()];
  entries.forEach(([node, { start, end }], k) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const mark = document.createElement("mark");
    mark.dataset.commentMark = id;
    if (k === 0) mark.id = `anchor-${id}`;
    mark.title = "Open comment — click to read it";
    mark.style.background = "var(--amber-soft)";
    mark.style.color = "inherit";
    mark.style.cursor = "pointer";
    mark.style.borderRadius = "2px";
    range.surroundContents(mark);
  });
  return true;
}

/**
 * The article's text, read-only, with open comments' passages marked; reports a selection inside it.
 *
 * ⚠ React 19 rewrites innerHTML whenever the dangerouslySetInnerHTML OBJECT
 * changes, not only its string — so a fresh `{ __html }` on any re-render (a
 * selection setting state above) would wipe the marks while the effect, whose
 * inputs didn't change, never re-ran. The object is memoized on the string, and
 * the anchors reach the effect as one string, so it re-marks exactly when they change.
 */
export function CommentableText({ html, anchors, onQuote }: { html: string; anchors: AnchorMark[]; onQuote?: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useMemo(() => ({ __html: html }), [html]);
  const anchorKey = JSON.stringify(anchors);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = html; // clears the previous marks
    for (const a of JSON.parse(anchorKey) as AnchorMark[]) markQuote(root, a.text, a.id);
  }, [html, anchorKey]);

  useEffect(() => {
    if (!onQuote) return;
    const onChange = () => {
      const root = ref.current;
      const sel = document.getSelection();
      if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return;
      if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return;
      const q = clipQuote(sel.toString());
      if (q.length >= 3) onQuote(q);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [onQuote]);

  return (
    <div
      ref={ref}
      // Server-rendered for the first paint; the effect re-sets it to clear old marks.
      dangerouslySetInnerHTML={inner}
      data-commentable-text
      className="article-preview text-sm leading-relaxed [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-3 [&_h3]:font-semibold [&_h3]:mt-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_img]:max-w-full [&_table]:text-xs"
      onClick={(e) => {
        const m = (e.target as HTMLElement).closest("mark[data-comment-mark]") as HTMLElement | null;
        if (m?.dataset.commentMark) {
          const li = document.getElementById(`comment-${m.dataset.commentMark}`);
          li?.scrollIntoView({ behavior: "smooth", block: "center" });
          li?.animate?.([{ background: "var(--amber-soft)" }, { background: "transparent" }], { duration: 1400 });
        }
      }}
    />
  );
}

/**
 * A textarea that offers the workspace's people after "@" — arrows to choose,
 * Enter or Tab to insert. Uncontrolled, so the form posts to its server action
 * without JavaScript and React's reset after a send empties it.
 */
function MentionTextarea({ members }: { members: MentionOption[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const q = query?.text.toLowerCase() ?? "";
  const matches = query
    ? members.filter((m) => m.handles.some((h) => h.toLowerCase().startsWith(q)) || m.label.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const open = matches.length > 0;

  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = before.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.'-]*(?: [\p{L}\p{N}_.'-]*){0,2})$/u);
    if (!m) { setQuery(null); return; }
    setQuery({ start: before.length - m[1].length - 1, text: m[1] });
    setActive(0);
  };

  const insert = (opt: MentionOption) => {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? el.value.length;
    el.value = `${el.value.slice(0, query.start)}@${opt.insert} ${el.value.slice(caret)}`;
    const pos = query.start + opt.insert.length + 2;
    setQuery(null);
    el.focus();
    el.setSelectionRange(pos, pos);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id="comment-body"
        name="body"
        required
        rows={3}
        maxLength={4000}
        placeholder="Leave a note… type @ to mention someone"
        className="w-full text-xs border border-[var(--line-2)] rounded-lg px-2 py-1"
        aria-autocomplete="list"
        onInput={(e) => detect(e.currentTarget)}
        onClick={(e) => detect(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(matches[Math.min(active, matches.length - 1)]); }
          else if (e.key === "Escape") { e.preventDefault(); setQuery(null); }
        }}
      />
      {open && (
        <ul role="listbox" data-mention-list className="absolute z-20 left-0 top-full mt-1 w-64 max-w-full card p-1 m-0 list-none text-xs shadow-lg">
          {matches.map((m, i) => (
            <li key={m.userId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded"
                style={i === active ? { background: "var(--panel)" } : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(m)}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The article to select from, and the comment form it fills. The quote field
 * stays editable — a heading typed by hand still works — and Clear empties it.
 * The form posts straight to the server action (it works without JavaScript);
 * the fields are uncontrolled, so React's reset after a send clears them.
 */
export function AnchoredCommentForm({
  postId, html, anchors, members,
}: {
  postId: string;
  html: string | null;
  anchors: AnchorMark[];
  members: MentionOption[];
}) {
  const anchorRef = useRef<HTMLInputElement>(null);
  const [hasAnchor, setHasAnchor] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const setAnchor = (v: string) => {
    if (anchorRef.current) anchorRef.current.value = v;
    setHasAnchor(!!v);
  };

  return (
    <>
      {html && (
        <details className="mb-3" open data-comment-text>
          <summary className="cursor-pointer select-none text-xs font-semibold mb-1">The article — select words to comment on them</summary>
          <div className="relative max-h-[28rem] overflow-y-auto border border-[var(--line)] rounded-lg px-3 py-2">
            <CommentableText html={html} anchors={anchors} onQuote={setPicked} />
            {picked && (
              <div className="sticky bottom-0 mt-2 -mx-1 flex items-center gap-2 flex-wrap rounded-lg px-2 py-1.5 text-xs border border-[var(--line-2)]" style={{ background: "var(--bg)" }} data-quote-bar>
                <span className="min-w-0 flex-1 truncate text-[var(--mute)]">“{picked}”</span>
                <button
                  type="button"
                  className="btn sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAnchor(picked);
                    setPicked(null);
                    document.getSelection()?.removeAllRanges();
                    const el = document.getElementById("comment-body");
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    el?.focus();
                  }}
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" /> Comment on this
                </button>
                <button type="button" className="btn sm" aria-label="Dismiss" onClick={() => setPicked(null)}><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </details>
      )}
      <form action={addBlogCommentAction} onReset={() => setHasAnchor(false)} className="flex flex-col gap-2" data-comment-form>
        <input type="hidden" name="postId" value={postId} />
        <div className="flex items-center gap-2">
          <input
            ref={anchorRef}
            id="comment-anchor"
            name="anchor"
            onInput={(e) => setHasAnchor(!!e.currentTarget.value)}
            maxLength={MAX_ANCHOR}
            placeholder="the passage or heading this is about — select it above, or type it (optional)"
            className="w-full text-xs border border-[var(--line-2)] rounded-lg px-2 py-1"
          />
          {hasAnchor && <button type="button" className="btn sm" onClick={() => setAnchor("")}>Clear</button>}
        </div>
        <MentionTextarea members={members} />
        <div><SubmitButton className="btn">Comment</SubmitButton></div>
      </form>
    </>
  );
}
