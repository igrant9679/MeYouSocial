"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Code2, Heading2, List, Plus, Quote, Text, Trash2 } from "lucide-react";
import {
  BLOCK_LABELS,
  TEXT_BLOCK_TYPES,
  type Block,
  type BlockType,
  blocksToPlainText,
  newBlockId,
  parseBlocks,
  plainTextToBlocks,
  serializeBlocks,
} from "@/lib/blocks";

/**
 * A block editor in the Gutenberg shape — typed blocks, one editable region
 * each, per-block controls, an inserter — built from the app's own components.
 * See src/lib/blocks.ts for why this is not WordPress's Gutenberg.
 *
 * `BlockList` is the presentation, controlled by whoever owns the blocks:
 *   · Company info uses `BlockEditor` below, which owns state and submits
 *     hidden form fields.
 *   · The article body uses `BlockList` directly, because HTML is that field's
 *     canonical form and BlogBodyEditor already owns it (autosave, word count).
 */

const TYPE_ICONS: Record<BlockType, React.ReactNode> = {
  paragraph: <Text className="w-3 h-3" />,
  heading: <Heading2 className="w-3 h-3" />,
  list: <List className="w-3 h-3" />,
  quote: <Quote className="w-3 h-3" />,
  html: <Code2 className="w-3 h-3" />,
};

export function BlockList({
  blocks,
  onChange,
  disabled,
  allowed = TEXT_BLOCK_TYPES,
  placeholder,
  emptyHint = "Empty — add a block below.",
  minRows = 3,
}: {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  disabled?: boolean;
  allowed?: readonly BlockType[];
  placeholder?: string;
  emptyHint?: string;
  minRows?: number;
}) {
  const update = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const add = (type: BlockType) =>
    onChange([
      ...blocks,
      {
        id: newBlockId(),
        type,
        text: "",
        ...(type === "heading" ? { level: 2 as const } : {}),
        ...(type === "list" ? { ordered: false } : {}),
      },
    ]);

  return (
    <div className="flex flex-col gap-2">
      {blocks.length === 0 && <p className="text-xs text-[var(--mute)] italic">{emptyHint}</p>}

      {blocks.map((b, i) => (
        <div key={b.id} className="rounded-lg border border-[var(--line)] px-2 py-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="font-mono text-[10px] text-[var(--mute)] px-1 inline-flex items-center gap-1">
              {TYPE_ICONS[b.type]} {BLOCK_LABELS[b.type]}
            </span>
            {b.type === "heading" && (
              <select
                value={b.level ?? 2}
                onChange={(e) => update(b.id, { level: e.target.value === "3" ? 3 : 2 })}
                disabled={disabled}
                className="text-[10px] font-mono !py-0"
                aria-label="Heading level"
              >
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </select>
            )}
            {b.type === "list" && (
              <select
                value={b.ordered ? "ordered" : "bulleted"}
                onChange={(e) => update(b.id, { ordered: e.target.value === "ordered" })}
                disabled={disabled}
                className="text-[10px] font-mono !py-0"
                aria-label="List style"
              >
                <option value="bulleted">Bulleted</option>
                <option value="ordered">Numbered</option>
              </select>
            )}
            {b.type === "html" && (
              <span className="text-[10px] text-[var(--mute)]">kept exactly as written</span>
            )}
            <span className="flex-1" />
            {/* type="button" is load-bearing: these sit inside a save form. */}
            <button
              type="button"
              onClick={() => move(b.id, -1)}
              disabled={disabled || i === 0}
              className="btn ghost !px-1 !py-0.5"
              title="Move up"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => move(b.id, 1)}
              disabled={disabled || i === blocks.length - 1}
              className="btn ghost !px-1 !py-0.5"
              title="Move down"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => onChange(blocks.filter((x) => x.id !== b.id))}
              disabled={disabled}
              className="btn ghost !px-1 !py-0.5"
              title={"Delete this " + BLOCK_LABELS[b.type].toLowerCase()}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          <textarea
            value={b.text}
            onChange={(e) => update(b.id, { text: e.target.value })}
            disabled={disabled}
            rows={b.type === "heading" ? 1 : minRows}
            placeholder={
              b.type === "heading"
                ? "Section heading"
                : b.type === "list"
                  ? "One item per line"
                  : b.type === "quote"
                    ? "A line worth quoting"
                    : b.type === "html"
                      ? "<figure>…</figure>"
                      : placeholder
            }
            className={
              "w-full leading-relaxed" +
              (b.type === "html" ? " font-mono text-xs" : " text-sm") +
              (b.type === "heading" ? " font-semibold" : "") +
              (b.type === "quote" ? " italic" : "")
            }
          />
          {b.type === "list" && b.text.trim() && (
            <p className="text-[10px] text-[var(--mute)] px-1">
              {b.text.split("\n").filter((l) => l.trim()).length} item(s)
            </p>
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-[var(--mute)] font-mono inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> add
          </span>
          {allowed.map((t) => (
            <button key={t} type="button" onClick={() => add(t)} className="btn ghost !text-[11px]">
              {TYPE_ICONS[t]} {BLOCK_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Form-field flavour: owns the blocks and submits them.
 *
 * ⚠ IT SUBMITS TWO FIELDS, and the plain one is load-bearing:
 *   · `<blocksName>` — the authored blocks as JSON.
 *   · `<textName>`   — the plain-text projection. The SERVER re-derives this
 *     from the blocks on save, so the copy here exists for two other reasons:
 *     AiAssist finds its target by `name` (so it keeps working untouched), and
 *     a browser with JS disabled still submits prose rather than wiping the
 *     field.
 *
 * ⚠ AiAssist accepts a draft by assigning `.value` and dispatching `input` on
 * that hidden field. We listen for exactly that and turn the accepted prose
 * into blocks — otherwise "Use it" would look like it did nothing, since what
 * the user sees is the block list, not the field.
 */
export function BlockEditor({
  initialBlocks,
  initialText,
  blocksName = "descriptionBlocks",
  textName = "description",
  disabled,
  placeholder,
  emptyHint,
  minRows = 3,
}: {
  initialBlocks: string | null;
  initialText: string;
  blocksName?: string;
  textName?: string;
  disabled?: boolean;
  placeholder?: string;
  emptyHint?: string;
  minRows?: number;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const parsed = parseBlocks(initialBlocks);
    // Content written before this editor existed still opens as blocks.
    return parsed.length ? parsed : plainTextToBlocks(initialText);
  });
  const plain = useMemo(() => blocksToPlainText(blocks), [blocks]);
  const hiddenRef = useRef<HTMLTextAreaElement>(null);
  const lastPushed = useRef<string>("");

  // Keep the hidden plain field in step with the blocks, through the prototype
  // setter so React's _valueTracker doesn't swallow the change.
  useEffect(() => {
    const el = hiddenRef.current;
    if (!el) return;
    lastPushed.current = plain;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, plain);
  }, [plain]);

  // …and adopt anything written INTO it from outside (AiAssist's "Use it").
  useEffect(() => {
    const el = hiddenRef.current;
    if (!el) return;
    const onInput = () => {
      const v = el.value;
      if (v === lastPushed.current) return; // our own write, echoed back
      lastPushed.current = v;
      setBlocks(plainTextToBlocks(v));
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, []);

  const onChange = useCallback((next: Block[]) => setBlocks(next), []);

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={blocksName} value={serializeBlocks(blocks)} readOnly />
      <textarea ref={hiddenRef} name={textName} defaultValue={plain} hidden readOnly aria-hidden tabIndex={-1} />

      <BlockList
        blocks={blocks}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        emptyHint={emptyHint}
        minRows={minRows}
      />

      <details className="text-[10px] text-[var(--mute)]">
        <summary className="cursor-pointer">
          Plain text the rest of the app reads ({plain.length.toLocaleString()} characters)
        </summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] bg-[var(--zebra)] rounded p-2">
          {plain || "(nothing yet)"}
        </pre>
      </details>
    </div>
  );
}
