"use client";

import { Download } from "lucide-react";
import { toCsv } from "@/lib/csv";

/**
 * "CSV" over a report table (E-MEA-02): downloads exactly what the table shows
 * — the header row and every body row of `table[data-csv="<table>"]` — so the
 * file can't disagree with the page. A dash is unmeasured, never zero, so it
 * leaves the cell blank rather than writing "—" or 0. Formula-looking cells are
 * neutralised by `toCsv`.
 */
export function CsvButton({ table, filename }: { table: string; filename: string }) {
  function download() {
    const el = document.querySelector<HTMLTableElement>(`table[data-csv="${table}"]`);
    if (!el) return;
    const text = (c: Element) => {
      const v = (c.textContent ?? "").replace(/\s+/g, " ").trim();
      return v === "—" || v === "–" ? "" : v;
    };
    // A two-row header (Topics: "Articles" over three columns, "Topic" down
    // both rows) is laid out as a grid, so each column is named once and in
    // full — "Articles: Out / made" — and lines up with the body cells.
    const grid: string[][] = [];
    [...(el.tHead?.rows ?? [])].forEach((row, r) => {
      let c = 0;
      for (const cell of [...row.cells]) {
        while ((grid[r] ??= [])[c] !== undefined) c++;
        for (let dr = 0; dr < cell.rowSpan; dr++) for (let dc = 0; dc < cell.colSpan; dc++) (grid[r + dr] ??= [])[c + dc] = text(cell);
        c += cell.colSpan;
      }
    });
    const width = Math.max(0, ...grid.map((g) => g.length));
    const header = Array.from({ length: width }, (_, c) => [...new Set(grid.map((g) => g[c]).filter(Boolean))].join(": "));
    const rows = [...el.tBodies].flatMap((b) => [...b.rows]).map((r) => [...r.cells].map(text));
    const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${filename}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button type="button" onClick={download} className="btn sm !py-0.5 !px-2 !text-[10px] inline-flex items-center gap-1 print:hidden" title="Download this table as CSV" data-csv-button={table}>
      <Download className="w-3 h-3" /> CSV
    </button>
  );
}
