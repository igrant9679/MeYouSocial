"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, HelpCircle, ExternalLink } from "lucide-react";
import { HELP_CATEGORIES } from "@/lib/help";
import type { Role } from "@prisma/client";
import { canFollow, whoCanFix } from "@/lib/role-links";

// Searchable + tag-filtered FAQ. Deep-linkable (E-SHL-11): ?cat= picks a
// category (the stage strips' "?" lands here), ?q= starts a search, and every
// answer has its own #anchor that opens it. "/" focuses the search.

/** A stable anchor for an answer: its category and the start of its question. */
export function faqAnchor(catId: string, q: string): string {
  return `faq-${catId}-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`;
}

export function HelpClient({ role, initialQuery = "", initialCat = "__all" }: { role: Role; initialQuery?: string; initialCat?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [activeCat, setActiveCat] = useState<string>(HELP_CATEGORIES.some((c) => c.id === initialCat) ? initialCat : "__all");
  const search = useRef<HTMLInputElement>(null);

  // "/" focuses the search, unless someone is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A #faq-… link opens that answer and brings it into view.
  useEffect(() => {
    const open = () => {
      const el = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) { el.open = true; el.scrollIntoView({ block: "start" }); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const lower = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return HELP_CATEGORIES.map((cat) => ({
      ...cat,
      entries: cat.entries.filter((e) => {
        if (activeCat !== "__all" && activeCat !== cat.id) return false;
        if (!lower) return true;
        const hay = (e.q + " " + e.a + " " + (e.tags ?? []).join(" ")).toLowerCase();
        return hay.includes(lower);
      }),
    })).filter((c) => c.entries.length > 0);
  }, [lower, activeCat]);

  const totalMatches = filtered.reduce((a, c) => a + c.entries.length, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
      {/* Sidebar */}
      <aside className="card p-3 h-fit lg:sticky lg:top-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-2 px-1">Categories</div>
        <ul className="m-0 p-0 flex flex-col gap-1">
          <li>
            <button onClick={() => setActiveCat("__all")} className={"w-full text-left px-2 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition " + (activeCat === "__all" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--mute)] hover:bg-[var(--zebra)]")}>
              All
            </button>
          </li>
          {HELP_CATEGORIES.map((cat) => (
            <li key={cat.id}>
              <button onClick={() => setActiveCat(cat.id)} className={"w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition " + (activeCat === cat.id ? "" : "text-[var(--mute)] hover:bg-[var(--zebra)]")} style={activeCat === cat.id ? { background: cat.soft, color: cat.color } : {}}>
                <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
                {cat.label}
                <span className="ml-auto text-[10px] opacity-60">{cat.entries.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main */}
      <main>
        {/* Search */}
        <div className="card mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--mute)]" />
          <input
            ref={search}
            aria-keyshortcuts="/"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the help center… press / (e.g. how to switch channels, dark mode, agent)"
            className="flex-1 bg-transparent border-0 focus:outline-none text-sm"
          />
          {query && <span className="text-[10px] font-mono text-[var(--mute)] uppercase">{totalMatches} match{totalMatches === 1 ? "" : "es"}</span>}
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <div className="card text-center py-12 text-sm text-[var(--mute)]">
            <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No matches. Try a different keyword, or click <button onClick={() => setQuery("")} className="text-[var(--accent)] font-semibold">clear</button>.
          </div>
        ) : (
          filtered.map((cat) => (
            <section key={cat.id} className="card mb-4">
              <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
                {cat.label}
                <span className="text-[10px] font-mono text-[var(--mute)] uppercase">({cat.entries.length})</span>
              </h2>
              <ul className="m-0 p-0 flex flex-col gap-2">
                {cat.entries.map((e, i) => (
                  <li key={i}>
                    <details className="group scroll-mt-20" id={faqAnchor(cat.id, e.q)}>
                      <summary className="cursor-pointer text-sm font-semibold py-2 px-3 rounded-md hover:bg-[var(--zebra)] flex items-center gap-2">
                        <span className="flex-1">{e.q}</span>
                        <a href={`#${faqAnchor(cat.id, e.q)}`} className="text-[var(--mute)] font-mono text-xs no-underline hover:text-[var(--ink)]" title="Link to this answer" aria-label="Link to this answer">#</a>
                        <span className="text-[var(--mute)] group-open:rotate-90 transition">▸</span>
                      </summary>
                      <div className="px-3 pb-3 pt-1 text-sm leading-[1.6] whitespace-pre-wrap" style={{ color: "var(--ink)" }}>
                        {formatMarkdownInline(e.a)}
                      </div>
                      {e.links && e.links.length > 0 && (
                        <div className="px-3 pb-3 flex flex-wrap gap-2">
                          {/* A page this role can't open says who can, instead of
                              bouncing to /forbidden (SHL-07). */}
                          {e.links.map((l) => canFollow(l.href, role) ? (
                            <Link key={l.href} href={l.href} className="btn sm flex items-center gap-1.5">
                              {l.label} <ExternalLink className="w-3 h-3" />
                            </Link>
                          ) : (
                            <span key={l.href} className="text-[11px] text-[var(--mute)] self-center" title={whoCanFix(l.href)}>
                              {l.label.replace(/\s*→\s*$/, "")} — {whoCanFix(l.href).replace(/\.$/, "").toLowerCase()}
                            </span>
                          ))}
                        </div>
                      )}
                      {e.tags && e.tags.length > 0 && (
                        <div className="px-3 pb-3 flex flex-wrap gap-1">
                          {e.tags.map((t) => (
                            <span key={t} className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--mute)] border border-[var(--line)]">#{t}</span>
                          ))}
                        </div>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

/** Tiny inline-Markdown for **bold** + `code`. Keeps things lightweight without pulling
 *  in a full Markdown renderer for a few help bullets. */
function formatMarkdownInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<b key={key++}>{m[1]}</b>);
    else if (m[2]) parts.push(<code key={key++} className="font-mono bg-[var(--zebra)] px-1 rounded">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
