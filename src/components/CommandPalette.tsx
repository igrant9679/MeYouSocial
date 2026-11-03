"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, Sparkles, Share2, Tags, HelpCircle, LayoutGrid, Bot, CornerDownLeft } from "lucide-react";

/**
 * Ctrl+K (⌘K on a Mac): one box for pages, articles, ideas, posts, Topics and
 * Help answers (E-SHL-06; /api/search, lib/global-search.ts). Arrow keys move,
 * Enter opens, Escape closes. The last row always offers to ask the assistant
 * the same words — the dock opens and sends them.
 *
 * Opened by the shortcut, by the header's Search button, or by a
 * `palette:open` event. Ctrl+/ stays the assistant's.
 */
type Hit = { kind: "page" | "article" | "idea" | "post" | "topic" | "help"; title: string; detail?: string | null; href: string };

const ICON = { page: LayoutGrid, article: FileText, idea: Sparkles, post: Share2, topic: Tags, help: HelpCircle } as const;
const GROUP: Record<Hit["kind"], string> = { page: "Pages", article: "Articles", idea: "Ideas", post: "Posts", topic: "Topics", help: "Help" };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  // The text those hits answer: Enter acts only once they're for what's typed.
  const [hitsFor, setHitsFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("palette:open", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("palette:open", onOpen); };
  }, []);

  // Debounced; a slower earlier answer never replaces a newer one.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`).then((x) => (x.ok ? x.json() : { hits: [] })).catch(() => ({ hits: [] }));
      if (mine !== seq.current) return;
      setHits(r.hits ?? []);
      setHitsFor(term);
      setActive(0);
      setBusy(false);
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const close = useCallback(() => { setOpen(false); setQ(""); setHits([]); setHitsFor(""); setActive(0); }, []);
  // Only results for the text as typed now — a stale list would send Enter to the wrong place.
  const fresh = q.trim().length >= 2 && hitsFor === q.trim();
  const shown = useMemo(() => (fresh ? hits : []), [fresh, hits]);
  const askRow = fresh;
  const total = shown.length + (askRow ? 1 : 0);

  const go = useCallback((i: number) => {
    if (i < shown.length) { router.push(shown[i].href); close(); return; }
    if (askRow) {
      window.dispatchEvent(new CustomEvent("assistant:ask", { detail: q.trim() }));
      close();
    }
  }, [shown, askRow, q, router, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[10vh] px-3" role="dialog" aria-modal="true" aria-label="Search" data-palette>
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full max-w-xl card !p-0 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-[var(--line)]">
          <Search className="w-4 h-4 text-[var(--mute)] shrink-0" />
          <input
            ref={input}
            // Focused as it mounts: the shortcut is pressed and typing starts at once.
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); close(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (total ? (a + 1) % total : 0)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (total ? (a - 1 + total) % total : 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(active); }
            }}
            placeholder="Search pages, articles, ideas, posts, Topics, Help…"
            className="flex-1 min-w-0 py-3 text-sm bg-transparent outline-none"
            aria-label="Search"
            data-palette-input
          />
          <kbd className="hidden sm:inline font-mono text-[10px] text-[var(--mute)] border border-[var(--line)] rounded px-1">Esc</kbd>
        </div>
        <ul className="m-0 p-1 list-none max-h-[60vh] overflow-y-auto" role="listbox" data-palette-results>
          {q.trim().length < 2 && <li className="px-3 py-2 text-xs text-[var(--mute)]">Type two letters or more. ↑ ↓ to move, Enter to open.</li>}
          {q.trim().length >= 2 && !fresh && <li className="px-3 py-2 text-xs text-[var(--mute)]" data-palette-searching>Searching…</li>}
          {fresh && !busy && shown.length === 0 && <li className="px-3 py-2 text-xs text-[var(--mute)]">Nothing here matches “{q.trim()}”.</li>}
          {shown.map((h, i) => {
            const Icon = ICON[h.kind];
            // The API returns each kind together, so a heading opens each run of one kind.
            const head = i === 0 || shown[i - 1].kind !== h.kind ? GROUP[h.kind] : null;
            return (
              <li key={`${h.kind}-${h.href}-${i}`}>
                {head && <div className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{head}</div>}
                <button type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(i)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg" style={i === active ? { background: "var(--accent-soft)" } : undefined} data-hit={h.kind}>
                  <Icon className="w-4 h-4 shrink-0 text-[var(--mute)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{h.title}</span>
                    {h.detail && <span className="block text-[11px] text-[var(--mute)] truncate">{h.detail}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="w-3.5 h-3.5 text-[var(--mute)] shrink-0" />}
                </button>
              </li>
            );
          })}
          {askRow && (
            <li>
              <div className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Or</div>
              <button type="button" role="option" aria-selected={active === shown.length} onMouseEnter={() => setActive(shown.length)} onClick={() => go(shown.length)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg" style={active === shown.length ? { background: "var(--accent-soft)" } : undefined} data-hit="ask">
                <Bot className="w-4 h-4 shrink-0" style={{ color: "var(--violet-on)" }} />
                <span className="text-sm truncate">Ask the assistant: “{q.trim()}”</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** The header's way in — the shortcut's label on wide screens, an icon on phones. */
export function PaletteButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("palette:open"))} className="btn sm items-center gap-1.5 !inline-flex" title="Search everything (Ctrl+K)" aria-label="Search" data-palette-button>
      <Search className="w-3.5 h-3.5" /> <span className="hidden @4xl:inline">Search</span> <kbd className="hidden @4xl:inline font-mono text-[10px] text-[var(--mute)]">Ctrl K</kbd>
    </button>
  );
}
