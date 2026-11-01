"use client";

import { useState } from "react";
import { ListTree, Search } from "lucide-react";
import { findAll, mmss, replaceAll, retentionMarkers, scriptSections } from "@/lib/script-outline";

// The editor's outline (E-VID-10): sections with their spoken length,
// retention markers, and find / replace. Everything is worked out from the
// text on screen; jumping selects the place in the editor, and Replace all
// hands the new text back to the editor, which autosaves it like typing.

const EVERY = [30, 45, 60] as const;

export function ScriptOutline({ body, onJump, onReplace }: {
  body: string;
  onJump: (offset: number, length: number) => void;
  onReplace: (next: string) => void;
}) {
  const [every, setEvery] = useState<(typeof EVERY)[number]>(45);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [hit, setHit] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const sections = scriptSections(body);
  const markers = retentionMarkers(body, every);
  const matches = findAll(body, find, matchCase);
  const total = sections.reduce((s, x) => s + x.seconds, 0);

  const next = () => {
    if (!matches.length) return;
    const i = hit % matches.length;
    onJump(matches[i], find.length);
    setHit(i + 1);
  };

  return (
    <details className="card !p-3 text-xs xl:h-full xl:overflow-auto" open data-script-outline>
      <summary className="cursor-pointer font-semibold flex items-center gap-1.5 list-none">
        <ListTree className="w-3.5 h-3.5" /> Outline <span className="font-normal text-[var(--mute)]">· {mmss(total)} spoken</span>
      </summary>

      <ol className="m-0 mt-2 p-0 list-none flex flex-col" data-outline-sections>
        {sections.map((s, i) => (
          <li key={`${s.offset}-${i}`}>
            <button type="button" onClick={() => onJump(s.offset, 0)} className="w-full text-left flex items-baseline gap-2 py-1 px-1 rounded hover:bg-[var(--zebra)]" data-outline-section={s.offset}>
              <span className="font-mono text-[10px] text-[var(--mute)] w-9 shrink-0">{mmss(s.startsAt)}</span>
              <span className="flex-1 truncate">{s.title}</span>
              <span className="font-mono text-[10px] text-[var(--mute)]" title={`${s.words} spoken words`}>{mmss(s.seconds)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 border-t border-[var(--line)] pt-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold">Retention markers</span>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value) as (typeof EVERY)[number])} className="border border-[var(--line-2)] rounded-md px-1 py-0.5 text-[11px]" aria-label="Marker interval" data-marker-every>
            {EVERY.map((n) => <option key={n} value={n}>every {n}s</option>)}
          </select>
        </div>
        <p className="m-0 mb-1 text-[10px] text-[var(--mute)]">Where a viewer is likely to drift — a place to re-hook them.</p>
        {markers.length === 0 ? (
          <p className="m-0 text-[var(--mute)]">The read is shorter than {every} seconds.</p>
        ) : (
          <ol className="m-0 p-0 list-none flex flex-col" data-outline-markers>
            {markers.map((m) => (
              <li key={m.at}>
                <button type="button" onClick={() => onJump(m.offset, 0)} className="w-full text-left flex items-baseline gap-2 py-0.5 px-1 rounded hover:bg-[var(--zebra)]" data-outline-marker={m.at}>
                  <span className="font-mono text-[10px] w-9 shrink-0" style={{ color: "var(--amber-on)" }}>{mmss(m.at)}</span>
                  <span className="flex-1 truncate text-[var(--mute)]">{m.snippet}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-3 border-t border-[var(--line)] pt-2 flex flex-col gap-1.5" data-outline-find>
        <span className="font-semibold flex items-center gap-1"><Search className="w-3 h-3" /> Find and replace</span>
        <input value={find} onChange={(e) => { setFind(e.target.value); setHit(0); setNote(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }} placeholder="Find" aria-label="Find" className="w-full border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" data-find-input />
        <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace with" aria-label="Replace with" className="w-full border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" data-replace-input />
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={matchCase} onChange={(e) => { setMatchCase(e.target.checked); setHit(0); }} /> Match case</label>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--mute)] flex-1" data-find-count>{find ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}</span>
          <button type="button" className="btn sm" disabled={!matches.length} onClick={next}>Next</button>
          <button
            type="button"
            className="btn sm"
            disabled={!matches.length}
            onClick={() => {
              const r = replaceAll(body, find, replace, matchCase);
              onReplace(r.body);
              setHit(0);
              setNote(`Replaced ${r.count}.`);
            }}
          >
            Replace all
          </button>
        </div>
        {note && <span className="text-[var(--mute)]" data-replace-note>{note}</span>}
      </div>
    </details>
  );
}
