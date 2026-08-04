import { KanbanSquare } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { ProductionSubNav } from "@/components/ProductionSubNav";

export default async function ProductionLayout({ children }: { children: React.ReactNode }) {
  await requireMembership();
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--teal-soft)", color: "var(--teal-on)" }}>
          <KanbanSquare className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Production</h1>
          <p className="text-xs text-[var(--mute)]">Run the channel. Writer's Room → Film Queue → Edit Bay → Calendar.</p>
        </div>
      </div>

      {/* The tab strip (with active state) lives in a client component — it
          needs usePathname, and lucide icons can't cross the props boundary. */}
      <ProductionSubNav />

      {children}
    </div>
  );
}
