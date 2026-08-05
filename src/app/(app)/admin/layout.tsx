import { requireRole, isPlatformOperator } from "@/lib/acl";
import { AdminSubNav } from "@/components/AdminSubNav";

// Admin sub-layout — tab strip (with active state) across the admin surfaces.
// The Workspaces tab is platform-operator-only, decided here (server) so the
// client strip never guesses.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole("ADMIN");
  return (
    <div>
      <AdminSubNav operator={isPlatformOperator(user.email)} />
      {children}
    </div>
  );
}
