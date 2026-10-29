import { Check, Minus } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { ROLE_PAGES } from "@/lib/role-links";

// Settings → Roles (E-SEC-17): what an admin, an editor and a viewer can do
// here, in one table, for everyone — so "why can't I?" has an answer before
// anyone hits a refusal. The page list underneath comes from lib/role-links.ts,
// the same map every link in the app asks, so it can't drift from the gates.

type Role = "ADMIN" | "EDITOR" | "VIEWER";
const ROLES: Role[] = ["VIEWER", "EDITOR", "ADMIN"];
const LABEL: Record<Role, string> = { VIEWER: "Viewer", EDITOR: "Editor", ADMIN: "Admin" };

// The lowest role that can do each thing (every role above it can too).
const CAPABILITIES: Array<{ what: string; needs: Role; note?: string }> = [
  { what: "See every page's numbers: the Inbox, ideas, articles, posts, reports, Measure", needs: "VIEWER" },
  { what: "Add, approve, reject and tag ideas; triage the board", needs: "EDITOR" },
  { what: "Write and edit articles; answer the questions only a person can", needs: "EDITOR" },
  { what: "Compose, schedule, queue and rearrange social posts", needs: "EDITOR", note: "with approval on, an editor's post waits for an admin" },
  { what: "Use the assistant", needs: "EDITOR", note: "its admin-only acts refuse for an editor" },
  { what: "Snooze and take Inbox items", needs: "EDITOR" },
  { what: "Approve social posts or ask for changes", needs: "ADMIN" },
  { what: "Schedule and publish articles; advance past a failing check", needs: "ADMIN" },
  { what: "Pause everything, full autonomy, the automation dials", needs: "ADMIN" },
  { what: "Invite people, change roles, issue a reset link", needs: "ADMIN", note: "nobody can change their own role" },
  { what: "Keys, connections, analytics, email, workspace settings", needs: "ADMIN" },
  { what: "Read the audit log", needs: "ADMIN" },
];
const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

export default async function RolesPage() {
  const { membership } = await requireMembership();
  const mine = membership.role as Role;
  return (
    <main className="w-full max-w-4xl">
      <h1 className="font-mono font-bold text-xl leading-tight mb-1">Roles</h1>
      <p className="text-xs text-[var(--mute)] mb-4">
        What each role can do in this workspace. You are <b className="text-[var(--ink)]">{LABEL[mine]}</b>; an admin changes roles under Settings → People.
      </p>

      <div className="card !p-0 overflow-x-auto mb-5">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[var(--mute)]">
              <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">What</th>
              {ROLES.map((r) => (
                <th key={r} className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-center" style={r === mine ? { color: "var(--ink)" } : undefined}>
                  {LABEL[r]}{r === mine ? " (you)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((c) => (
              <tr key={c.what} className="border-b border-[var(--line)] last:border-0 align-top">
                <td className="py-1.5 px-2">{c.what}{c.note && <span className="block text-[10px] text-[var(--mute)]">{c.note}</span>}</td>
                {ROLES.map((r) => (
                  <td key={r} className="py-1.5 px-2 text-center" aria-label={RANK[r] >= RANK[c.needs] ? `${LABEL[r]}: yes` : `${LABEL[r]}: no`}>
                    {RANK[r] >= RANK[c.needs]
                      ? <Check className="w-3.5 h-3.5 inline" style={{ color: "var(--green-on)" }} />
                      : <Minus className="w-3.5 h-3.5 inline text-[var(--mute)]" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-mono font-bold text-sm mb-1">Pages a role is needed for</h2>
      <p className="text-[11px] text-[var(--mute)] mb-2">Everything else is open to every member. Links to these pages say who can act instead of sending you to a refusal.</p>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        {(["ADMIN", "EDITOR"] as const).map((r) => (
          <div key={r} className="card">
            <b>{LABEL[r]}{r === "EDITOR" ? " and admin" : ""}</b>
            <ul className="m-0 mt-1 pl-4 font-mono text-[11px] text-[var(--mute)]">
              {ROLE_PAGES[r].map((p) => <li key={p}>{p}{p.endsWith("/") ? "" : p.includes("<") ? "" : " and below"}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
