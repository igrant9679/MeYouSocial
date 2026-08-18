"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Blocks, Code2, Eye, PencilLine } from "lucide-react";
import { autosaveBlogBodyAction } from "@/app/actions/blog";
import { BlockList } from "@/components/BlockEditor";
import { RICH_BLOCK_TYPES, type Block, blocksToHtml, htmlToBlocks } from "@/lib/blocks";

/**
 * Blog body editor (Wave A′): HTML source, a BLOCK editor, and a rendered
 * preview, plus live word count / reading time and debounced autosave (3s
 * idle). The <textarea> is named "body" so the surrounding form's explicit Save
 * still works and creates a version; autosave writes body only (no version
 * churn). Preview sanitization: scripts/iframes/event handlers stripped
 * client-side.
 *
 * ⚠ HTML IS THE CANONICAL FORM, BLOCKS ARE A VIEW OVER IT. `BlogPost.body` is
 * what publishCore sends to WordPress, what the HTML export embeds and what the
 * checks read, so the block mode converts on the way in and out rather than
 * storing anything of its own. Anything blocks can't model — an image, a
 * figure, a table, an embed, a nested list — round-trips VERBATIM inside an
 * `html` block (see src/lib/blocks.ts). A lossy pass over a published article
 * is precisely the kind of silent damage this codebase keeps finding, and it
 * doesn't get to happen here.
 *
 * ⚠ Switching INTO blocks does not touch `body`. Conversion alone would rewrite
 * a hand-tuned article's whitespace and attribute order the moment someone
 * clicked the tab out of curiosity; the body is only rewritten once a block is
 * actually edited.
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

type Mode = "source" | "blocks" | "preview";

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
  const [mode, setMode] = useState<Mode>("source");
  const [blocks, setBlocks] = useState<Block[]>([]);
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
    // Entering blocks: parse the CURRENT body. Leaving it: keep whatever the
    // blocks produced, which `onBlocks` has already written into body.
    if (next === "blocks") setBlocks(htmlToBlocks(body));
    setMode(next);
  }

  function onBlocks(next: Block[]) {
    setBlocks(next);
    setBody(blocksToHtml(next));
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
        <span className="block text-xs text-[var(--mute)]">Body {mode === "source" ? "(HTML)" : mode === "blocks" ? "(blocks)" : "(preview)"}</span>
        <span className="font-mono text-[10px] text-[var(--mute)]">
          {words.toLocaleString()} words · ~{minutes} min read
          {saveState === "pending" && " · saving…"}
          {saveState === "saved" && " · autosaved"}
        </span>
        <span className="flex-1" />
        {tab("source", "Source", <Code2 className="w-3.5 h-3.5" />)}
        {tab("blocks", "Blocks", <Blocks className="w-3.5 h-3.5" />)}
        {tab("preview", "Preview", <Eye className="w-3.5 h-3.5" />)}
      </div>

      {mode === "preview" && (
        <div
          className="rounded-lg border border-[var(--line)] p-4 text-sm leading-relaxed max-h-[480px] overflow-y-auto [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h3]:font-semibold [&_h3]:mt-3 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: sanitize(body) || "<p style='color:var(--mute)'>Nothing to preview yet.</p>" }}
        />
      )}

      {mode === "blocks" && (
        <div className="rounded-lg border border-[var(--line)] p-2 max-h-[560px] overflow-y-auto">
          <p className="text-[10px] text-[var(--mute)] mb-2">
            Editing as blocks. Links and bold stay as inline HTML inside a block; images, tables and
            anything else are kept whole in an <b>HTML</b> block so nothing is lost on the way back.
          </p>
          <BlockList
            blocks={blocks}
            onChange={onBlocks}
            disabled={disabled}
            allowed={RICH_BLOCK_TYPES}
            placeholder="Write here, or generate a grounded AI draft below."
            emptyHint="No blocks yet — add one below, or switch to Source if the article is empty."
            minRows={4}
          />
        </div>
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
      {/* The form must submit the body from every mode, not just Source. */}
      {mode !== "source" && <input type="hidden" name="body" value={body} />}
    </div>
  );
}
