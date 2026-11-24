import { redirect } from "next/navigation";
import { FolderLock } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { planOwnerBackfill } from "@/lib/storage/owner-backfill";
import { applyFileOwnersAction } from "@/app/actions/file-owners";
import { SubmitButton } from "@/components/SubmitButton";

// Settings → File owners (2026-11-24), platform operator only: the files stored before owners were recorded
// (2026-10-29), which workspace uses each, and the button that gives them owners. Reading this page writes nothing;
// the button is the operator's. Keys are shortened — they're the files' addresses.

export const dynamic = "force-dynamic";

const short = (k: string) => (k.length > 18 ? `${k.slice(0, 10)}…${k.slice(-6)}` : k);

export default async function FileOwnersPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const [plan, workspaces, ownedTotal] = await Promise.all([
    planOwnerBackfill(),
    db.workspace.findMany({ select: { id: true, name: true, deletedAt: true } }),
    db.storedObject.count(),
  ]);
  const name = new Map(workspaces.map((w) => [w.id, `${w.name}${w.deletedAt ? " (deleted)" : ""}`]));
  const label = (id: string | null) => (id ? name.get(id) ?? id : "a purged workspace");
  const sources = Object.entries(plan.bySource).sort((a, b) => b[1] - a[1]);

  return (
    <main className="w-full max-w-3xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <FolderLock className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">File owners</h1>
          <p className="text-xs text-[var(--mute)] m-0">
            Since 29 Oct every stored file records the workspace that owns it, and only that workspace&apos;s members can open it.
            Files stored before then have no owner, so any signed-in member of any workspace can open one if its link reaches them.
            This page finds which workspace uses each of them. Reading it changes nothing.
          </p>
        </div>
      </div>

      <section className="card mb-4 text-xs grid grid-cols-2 sm:grid-cols-4 gap-3" data-file-owner-counts>
        <Stat n={plan.referenced} label="files referenced anywhere" />
        <Stat n={plan.owned} label="already have an owner" />
        <Stat n={plan.candidates.length} label="no owner, used by one workspace" strong />
        <Stat n={plan.ambiguous.length} label="no owner, used by several (left alone)" />
      </section>

      <section className="card mb-4 text-xs flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold m-0">What “Give them owners” would do</h2>
        {plan.candidates.length === 0 ? (
          <p className="m-0 text-[var(--mute)]">Nothing: every referenced file already has an owner, or is used by more than one workspace.</p>
        ) : (
          <>
            <p className="m-0">Give each of these {plan.candidates.length} files the one workspace that uses it:</p>
            <ul className="m-0 pl-4" data-file-owner-by-workspace>
              {Object.entries(plan.byWorkspace).sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                <li key={id}><b>{label(id)}</b> — {n} file{n === 1 ? "" : "s"}</li>
              ))}
            </ul>
            <p className="m-0 text-[var(--mute)]">
              Afterwards those files open only for that workspace&apos;s members and you. Files used by several workspaces, and files
              nothing in Publisher points at, keep today&apos;s rule. Owner rows already written are never changed.
            </p>
          </>
        )}
      </section>

      <section className="card mb-4 text-xs">
        <h2 className="text-sm font-semibold m-0 mb-1">Where the references were found</h2>
        <table className="w-full">
          <tbody>
            {sources.map(([where, n]) => (
              <tr key={where} className="border-t border-[var(--line)]"><td className="py-1">{where}</td><td className="py-1 text-right font-mono">{n}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-1 text-[var(--mute)]">{ownedTotal} owner rows are on record in all.</p>
      </section>

      {plan.ambiguous.length > 0 && (
        <section className="card mb-4 text-xs" data-file-owner-ambiguous>
          <h2 className="text-sm font-semibold m-0 mb-1">Used by more than one workspace ({plan.ambiguous.length}) — left alone</h2>
          <ul className="m-0 pl-4">
            {plan.ambiguous.slice(0, 20).map((a) => (
              <li key={a.key}><span className="font-code">{short(a.key)}</span> — {a.workspaceIds.map(label).join(", ")} <span className="text-[var(--mute)]">({a.where.join(", ")})</span></li>
            ))}
          </ul>
          {plan.ambiguous.length > 20 && <p className="m-0 text-[var(--mute)]">…and {plan.ambiguous.length - 20} more.</p>}
        </section>
      )}

      {plan.ownedElsewhere.length > 0 && (
        <section className="card mb-4 text-xs" data-file-owner-elsewhere>
          <h2 className="text-sm font-semibold m-0 mb-1">Owned by one workspace, used by another ({plan.ownedElsewhere.length}) — worth a look, not changed</h2>
          <ul className="m-0 pl-4">
            {plan.ownedElsewhere.slice(0, 20).map((o) => (
              <li key={o.key}><span className="font-code">{short(o.key)}</span> — owner {label(o.owner)}, used by {label(o.usedBy)}</li>
            ))}
          </ul>
        </section>
      )}

      {plan.candidates.length > 0 && (
        <form action={applyFileOwnersAction} className="card mb-4 text-xs flex flex-col gap-2" data-file-owner-apply>
          <label className="inline-flex items-start gap-2 cursor-pointer">
            <input type="checkbox" name="confirm" className="mt-0.5" />
            <span>I&apos;ve read the numbers above. Give these {plan.candidates.length} files the workspace that uses them, so only its members can open them.</span>
          </label>
          <SubmitButton className="btn sm self-start" pendingText="Writing owners…">Give them owners</SubmitButton>
          <span className="text-[var(--mute)]">It plans again before writing, so anything uploaded meanwhile is counted as it is then.</span>
        </form>
      )}
      <p className="text-2xs text-[var(--mute)]">Planned {new Date(plan.at).toISOString().replace("T", " ").slice(0, 16)} UTC.</p>
    </main>
  );
}

function Stat({ n, label, strong = false }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-2xl ${strong ? "font-bold" : ""}`}>{n}</span>
      <span className="text-[var(--mute)]">{label}</span>
    </div>
  );
}
