/**
 * CSV in and out (E-IDE-24), for strategists working in sheets. RFC 4180:
 * fields with a comma, quote or line break are quoted, quotes doubled.
 *
 * ⚠ A cell starting with = + - @ (or a tab / CR) is a formula to Excel and
 * Sheets — an idea titled "=HYPERLINK(…)" would run when the file is opened.
 * Exported cells like that are prefixed with an apostrophe, which spreadsheets
 * show as plain text; imports strip that apostrophe back off.
 */

const FORMULA = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // A BOM so Excel reads UTF-8 (names with accents) without an import dialog.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Rows of fields. Tolerates a BOM, CRLF or LF, quoted fields across lines. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((f) => (f.startsWith("'") && FORMULA.test(f.slice(1)) ? f.slice(1) : f)));
}

/** The header row as lower-case names, and each later row as a record of them. */
export function csvRecords(text: string): { header: string[]; records: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text);
  const header = head.map((h) => h.trim().toLowerCase());
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}
