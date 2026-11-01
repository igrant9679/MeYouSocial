import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { keyring } from "@/lib/keyring";
import { secretRows, needsWrite, type SecretPlace, type SecretState } from "@/lib/keyring-sweep";
import { reencryptAction } from "@/app/actions/keyring";
import { SubmitButton } from "@/components/SubmitButton";

// Settings → Keyring (E-SEC-04), platform operator only: which key every stored
// secret is encrypted with, the re-encrypt button, and how to replace
// TOKEN_ENCRYPTION_KEY without stranding anything. Shows key ids and setting
// names, never a value.

const PLACE: Record<SecretPlace, string> = {
  settings: "Keys and passwords in Settings",
  oauth: "Google sign-ins (YouTube, Analytics, Drive)",
  wordpress: "WordPress passwords",
  two_factor: "Two-factor secrets",
};
const STATES: { s: SecretState; label: string }[] = [
  { s: "current", label: "Current key" },
  { s: "older", label: "Older key" },
  { s: "unlabelled", label: "No key id yet" },
  { s: "plain", label: "Not encrypted" },
  { s: "unreadable", label: "Can't be read" },
];

export default async function KeyringPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const ring = keyring();
  const rows = await secretRows();
  const names = new Map((await db.workspace.findMany({ select: { id: true, name: true } })).map((w) => [w.id, w.name]));
  const count = (p: SecretPlace, s: SecretState) => rows.filter((r) => r.place === p && r.state === s).length;
  const pending = rows.filter(needsWrite).length;
  const unreadable = rows.filter((r) => r.state === "unreadable");
  const olderIds = [...new Set(rows.filter((r) => r.state === "older").map((r) => r.kid))];
  const inUse = new Set(rows.map((r) => r.kid));

  return (
    <main className="w-full max-w-3xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <KeyRound className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">Keyring</h1>
          <p className="text-xs text-[var(--mute)] m-0">Every stored secret — API keys, passwords, sign-ins and two-factor secrets, in all {names.size} workspaces — is encrypted with a key named by its id. Values are never shown here.</p>
        </div>
      </div>

      <section className="card mb-4 text-xs flex flex-col gap-1.5" data-keyring-current={ring.current?.id ?? ""}>
        {ring.current
          ? <span>Current key: <b className="font-mono">{ring.current.id}</b> <span className="text-[var(--mute)]">(TOKEN_ENCRYPTION_KEY) — new secrets are encrypted with it.</span></span>
          : <b style={{ color: "var(--rose-on)" }}>TOKEN_ENCRYPTION_KEY isn&apos;t set: new secrets are stored unencrypted, and WordPress, Google sign-ins and two-factor can&apos;t be saved.</b>}
        <span>
          Older keys still read:{" "}
          {ring.previous.length
            ? ring.previous.map((k, i) => (
                <span key={k.id}>{i > 0 && ", "}<b className="font-mono">{k.id}</b> <span className="text-[var(--mute)]">({inUse.has(k.id) ? "still in use" : "nothing uses it — safe to remove"})</span></span>
              ))
            : <span className="text-[var(--mute)]">none (TOKEN_ENCRYPTION_KEY_PREVIOUS is empty)</span>}
        </span>
        {ring.problems.map((p) => <span key={p} style={{ color: "var(--rose-on)" }}>{p}.</span>)}
      </section>

      {unreadable.length > 0 && (
        <section className="card mb-4 text-xs flex flex-col gap-1" style={{ borderColor: "var(--rose)" }} data-keyring-unreadable={unreadable.length}>
          <b style={{ color: "var(--rose-on)" }}>{unreadable.length} secret{unreadable.length === 1 ? "" : "s"} can&apos;t be read with any configured key — they read as not set.</b>
          <span>Put the key they were encrypted with back in TOKEN_ENCRYPTION_KEY_PREVIOUS, or enter them again.</span>
          <ul className="m-0 pl-4">
            {unreadable.slice(0, 20).map((r, i) => (
              <li key={i}>{r.label} — {r.workspaceId ? names.get(r.workspaceId) ?? "a deleted workspace" : r.place === "two_factor" ? "a person" : "the platform"}{r.kid ? <> (key <span className="font-mono">{r.kid}</span>)</> : null}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="card mb-4 overflow-x-auto">
        <table className="w-full text-xs" data-keyring-table>
          <thead>
            <tr className="text-left text-[var(--mute)]">
              <th className="py-1 pr-2 font-normal">Where</th>
              {STATES.map((c) => <th key={c.s} className="py-1 px-2 font-normal text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PLACE) as SecretPlace[]).map((p) => (
              <tr key={p} className="border-t border-[var(--line)]" data-place={p}>
                <td className="py-1.5 pr-2">{PLACE[p]}</td>
                {STATES.map((c) => {
                  const n = count(p, c.s);
                  return <td key={c.s} data-state={c.s} className="py-1.5 px-2 text-right font-mono" style={n && c.s === "unreadable" ? { color: "var(--rose-on)" } : n && c.s !== "current" ? { color: "var(--amber-on)" } : undefined}>{n}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={reencryptAction} className="card mb-4 text-xs flex flex-col gap-2">
        <b>Re-encrypt with the current key</b>
        <span className="text-[var(--mute)]">
          {pending
            ? `${pending} secret${pending === 1 ? "" : "s"} would be rewritten${olderIds.length ? ` (older key${olderIds.length === 1 ? "" : "s"} ${olderIds.join(", ")})` : ""}. Nothing changes for anyone using them; a secret saved while this runs keeps its new value.`
            : "Everything readable is already under the current key."}
        </span>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirm" value="yes" className="mt-0.5" />
          <span>Rewrite every workspace&apos;s stored secrets now.</span>
        </label>
        <div><SubmitButton className="btn sm" pendingText="Re-encrypting…" disabled={!ring.current || !pending}>Re-encrypt</SubmitButton></div>
      </form>

      <section className="card text-xs flex flex-col gap-1.5">
        <b>Replacing the key</b>
        <ol className="m-0 pl-4 flex flex-col gap-1">
          <li>Make a new key: <code className="font-mono">node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code></li>
          <li>On Railway, put the current key into <code className="font-mono">TOKEN_ENCRYPTION_KEY_PREVIOUS</code> (comma-separated if it already holds one), then the new key into <code className="font-mono">TOKEN_ENCRYPTION_KEY</code>, and let it redeploy.</li>
          <li>Come back here: the new id is the current key and everything else is under an older key. Re-encrypt.</li>
          <li>When no row shows an older key, remove that key from <code className="font-mono">TOKEN_ENCRYPTION_KEY_PREVIOUS</code>.</li>
        </ol>
        <span className="text-[var(--mute)]">Never remove a key something still uses: those secrets can&apos;t be read again and have to be entered by hand.</span>
      </section>
    </main>
  );
}
