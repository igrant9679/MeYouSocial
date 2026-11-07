import Link from "next/link";
import { Check, AlertTriangle, X } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { canFollow, whoCanFix } from "@/lib/role-links";
import { connectionRows } from "@/lib/setup-status";

// Settings → Connections: keys and connections, one row each, connected or
// not, and the page that fixes it. The forms themselves stay where they are
// (API keys, Connections, Analytics, Website) — those pages validate formats,
// probe live and gate platform-managed keys, and none of that should be
// duplicated; this is the one place that answers "what's missing?".

const STATE = {
  ok: { icon: Check, hue: "green", word: "connected" },
  partial: { icon: AlertTriangle, hue: "amber", word: "partly" },
  missing: { icon: X, hue: "rose", word: "missing" },
} as const;

export default async function SetupConnections() {
  const { workspace, membership } = await requireMembership();
  const rows = await connectionRows(workspace.id);
  // Only what the loop needs counts as missing (E-SET-03); the rest are extras.
  const missing = rows.filter((r) => r.required && r.state === "missing").length;
  const extrasOff = rows.filter((r) => !r.required && r.state === "missing").length;

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h1 className="font-mono text-2xl font-bold m-0">Connections</h1>
        <p className="text-sm text-[var(--mute)] m-0">
          {missing === 0 ? `Everything ${workspace.name}'s loop needs is connected.` : `${missing} thing${missing === 1 ? "" : "s"} the loop needs ${missing === 1 ? "is" : "are"} missing.`}
          {extrasOff > 0 && ` ${extrasOff} optional extra${extrasOff === 1 ? "" : "s"} not set up.`}
        </p>
      </div>
      <section className="card">
        <ul className="m-0 p-0 flex flex-col">
          {rows.map((r) => {
            const s = STATE[r.state];
            const Icon = s.icon;
            return (
              <li key={r.key} className="border-t border-[var(--line)] first:border-t-0 py-2.5 flex items-center gap-3 flex-wrap">
                <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: `var(--${s.hue}-soft)`, color: `var(--${s.hue}-on)` }} title={s.word}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <div className="flex-1 min-w-48">
                  <div className="text-sm font-semibold leading-snug">
                    {r.label}
                    <span className="font-mono text-micro ml-2 px-1.5 py-0.5 rounded-full" style={r.required ? { background: "var(--accent-soft)", color: "var(--accent-on)" } : { background: "var(--zebra)", color: "var(--mute)" }} data-conn-kind={r.required ? "required" : "optional"}>{r.required ? "needed" : "optional"}</span>
                    {r.note && <span className="font-mono text-micro text-[var(--mute)] ml-2">{r.note}</span>}
                  </div>
                  <div className="text-2xs text-[var(--mute)]">{r.detail}{r.source ? ` — ${r.source}` : ""}</div>
                </div>
                {/* Most fixes live on admin pages: say so rather than bounce (SHL-07). */}
                {canFollow(r.href, membership.role)
                  ? <Link href={r.href} className="btn sm">{r.state === "ok" ? "Open" : "Fix"}</Link>
                  : r.state !== "ok" && <span className="text-2xs text-[var(--mute)] max-w-40 text-right">{whoCanFix(r.href)}</span>}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-2xs text-[var(--mute)] mt-3">
        Keys are read from the workspace first, then the platform, then the environment; the API keys page shows which source each resolves to.
      </p>
    </div>
  );
}
