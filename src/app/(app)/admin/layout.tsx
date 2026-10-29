import { ShieldCheck } from "lucide-react";
import { requireRole } from "@/lib/acl";

// ⚠ The admin pages no longer bring their own tab strip (audit B1.4). They are
// tabs of Settings now — the StageStrip in the app shell renders them, because
// stageFor() maps /admin/* to "/setup". AdminSubNav was the SECOND strip on
// these pages and is gone; the files stayed exactly where they were, since
// around thirty actions redirect to /admin/* URLs.
//
// requireRole("ADMIN") stays: it is the real server gate. The strip's `admin`
// flag only decides whether the tabs are OFFERED.
//
// E-SEC-13: every admin page says which company it changes — an operator in
// several, or anyone with two tabs open, can't mistake whose keys these are.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireRole("ADMIN");
  return (
    <div>
      <p className="text-[11px] mb-3 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 flex-wrap" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        Editing <b>{workspace.name}</b> — what you change here applies to this workspace only.
        <span className="font-mono text-[10px] opacity-75" title="Workspace id">{workspace.id.slice(0, 10)}</span>
      </p>
      {children}
    </div>
  );
}
