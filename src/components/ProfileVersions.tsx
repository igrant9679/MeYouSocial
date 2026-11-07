import { History } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { restoreProfileVersionAction } from "@/app/actions/profile-versions";
import { formatZonedMoment } from "@/lib/zoned-dates";
import type { VersionRow } from "@/lib/profile-versions";

/**
 * A voice profile's or audience avatar's versions (E-SET-07): newest first,
 * what made each and who, Compare against what's current field by field, and
 * Restore. The version that matches the current state says so instead.
 */
export function ProfileVersions({ versions, editor, timeZone, noun }: { versions: VersionRow[]; editor: boolean; timeZone: string; noun: string }) {
  return (
    <section className="card" data-profile-versions>
      <h2 className="font-mono text-sm font-bold mb-1 flex items-center gap-2">
        <History className="w-4 h-4" style={{ color: "var(--violet)" }} /> Versions
        <span className="text-xs text-[var(--mute)] font-normal">{versions.length}</span>
      </h2>
      {versions.length === 0 ? (
        <p className="text-xs text-[var(--mute)] m-0">No versions yet — refining, retraining, editing or refreshing this {noun} keeps one, so it can be compared and brought back.</p>
      ) : (
        <ol className="m-0 p-0 list-none flex flex-col">
          {versions.map((v) => {
            const current = v.changes.length === 0;
            return (
              <li key={v.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-xs" data-version={v.n} data-current={current ? "1" : undefined}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold">v{v.n}</span>
                  <span className="flex-1 min-w-0 break-words">{v.label}</span>
                  <span className="text-micro text-[var(--mute)]">{v.by ? `${v.by} · ` : ""}{formatZonedMoment(v.createdAt, timeZone)}</span>
                  {current ? (
                    <span className="font-mono text-micro uppercase px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>current</span>
                  ) : editor ? (
                    <form action={restoreProfileVersionAction}>
                      <input type="hidden" name="versionId" value={v.id} />
                      <SubmitButton className="btn sm" pendingText="Restoring…" title={`Make this the ${noun} again — what's there now is kept as a version`}>Restore</SubmitButton>
                    </form>
                  ) : null}
                </div>
                {!current && (
                  <details className="mt-1" data-compare={v.n}>
                    <summary className="cursor-pointer text-2xs text-[var(--mute)]">Compare with now · {v.changes.length} field{v.changes.length === 1 ? "" : "s"} differ</summary>
                    <table className="w-full mt-1 text-2xs border-collapse">
                      <thead>
                        <tr className="text-left text-micro uppercase tracking-wider font-mono text-[var(--mute)]">
                          <th className="py-1 pr-2 w-1/5">Field</th>
                          <th className="py-1 pr-2">Now</th>
                          <th className="py-1">v{v.n}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.changes.map((c) => (
                          <tr key={c.field} className="border-t border-[var(--line)] align-top" data-field={c.field}>
                            <td className="py-1 pr-2 font-mono break-all">{c.field}</td>
                            <td className="py-1 pr-2 whitespace-pre-wrap break-words" style={{ color: "var(--rose-on)" }}>{c.before ?? <i className="text-[var(--mute)]">—</i>}</td>
                            <td className="py-1 whitespace-pre-wrap break-words" style={{ color: "var(--green-on)" }}>{c.after ?? <i className="text-[var(--mute)]">—</i>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
