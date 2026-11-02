"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";
import { importSocialCsvAction, type CsvImportResult } from "@/app/actions/social-workflow";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Compose → Import from CSV (E-SOC-16): "Check the file" first — every row is
 * judged and nothing is written — then "Import". Both list each row with what
 * it would become or why it can't. The template carries every column.
 */
export function SocialCsvImport() {
  const [result, action] = useActionState<CsvImportResult | null, FormData>(importSocialCsvAction, null);
  return (
    <div className="flex flex-col gap-2" data-csv-import>
      <form action={action} className="flex flex-wrap items-center gap-2" encType="multipart/form-data">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
        <SubmitButton className="btn sm" name="op" value="check" pendingText="Checking…">Check the file</SubmitButton>
        <SubmitButton className="btn sm primary" name="op" value="import" pendingText="Importing…">Import</SubmitButton>
        <a href="/api/social/import-template" className="text-xs underline inline-flex items-center gap-1 text-[var(--mute)]" data-csv-template><Download className="w-3 h-3" /> Template</a>
      </form>
      {result && (
        <div className="rounded-lg border p-2 text-xs" style={{ borderColor: result.ok ? "var(--green)" : "var(--amber)" }} data-csv-result={result.mode}>
          <p className="m-0 font-semibold" style={{ color: result.ok ? "var(--green-on)" : "var(--amber-on)" }} data-csv-summary>{result.summary}</p>
          {result.rows.length > 0 && (
            <ul className="m-0 mt-1.5 p-0 list-none flex flex-col gap-0.5 max-h-72 overflow-auto">
              {result.rows.map((r) => (
                <li key={r.row} className="font-mono text-[11px]" data-csv-row={r.row} data-csv-row-ok={r.ok ? "1" : "0"}>
                  <span style={{ color: r.ok ? "var(--green-on)" : "var(--rose-on)" }}>{r.ok ? "✓" : "✗"} row {r.row}</span>
                  <span className="text-[var(--mute)]"> — {r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
