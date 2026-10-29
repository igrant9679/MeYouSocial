import Link from "next/link";
import { ShieldQuestion } from "lucide-react";
import type { ConfirmPreview } from "@/lib/assistant/preview";

/**
 * The assistant's proposal, as a card (E-ENG-01): what will run and on what —
 * the tool, the post's real text and networks, the time in the posting zone,
 * an image — built on the server from the tool's arguments. Presentational only,
 * so the dock (client) and the thread page (server) draw the same card; the Yes
 * that answers it carries the proposal's nonce and lives with each caller.
 */
export function ConfirmCard({ tool, summary, preview, expires }: { tool: string; summary: string; preview?: ConfirmPreview; expires?: string | null }) {
  return (
    <div className="mt-2 rounded-lg border p-2.5 text-xs flex flex-col gap-1.5" style={{ borderColor: "var(--amber)", background: "var(--panel)" }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <ShieldQuestion className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--amber-on)" }} />
        <b>Waiting for your yes</b>
        <span className="font-mono text-[10px] text-[var(--mute)]">{tool}</span>
        {expires && <span className="text-[10px] text-[var(--mute)] ml-auto">until {expires}</span>}
      </div>
      <p className="m-0">{summary}</p>
      {preview && (
        <div className="flex gap-2 items-start">
          {preview.image && (
            // Stored files are session-gated; next/image's optimiser fetches without the session.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image} alt="" className="w-16 h-16 rounded object-cover border border-[var(--line)] shrink-0" />
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {preview.body && <p className="m-0 whitespace-pre-wrap rounded px-2 py-1 bg-[var(--zebra)] max-h-40 overflow-auto">{preview.body}</p>}
            {preview.fields.length > 0 && (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                {preview.fields.map((f, i) => (
                  <div key={i} className="contents">
                    <dt className="text-[var(--mute)]">{f.label}</dt>
                    <dd className="m-0 break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {preview.href && <Link href={preview.href} className="underline text-[11px] self-start">Open it</Link>}
          </div>
        </div>
      )}
      <p className="m-0 text-[10px] text-[var(--mute)]">Nothing runs until you say yes — and it&apos;s checked again just before it does.</p>
    </div>
  );
}
