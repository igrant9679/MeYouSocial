import { requireRole } from "@/lib/acl";
import { AdminSubNav } from "@/components/AdminSubNav";

// Admin sub-layout — tab strip (with active state) across the admin surfaces.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return (
    <div>
      <AdminSubNav />
      {children}
    </div>
  );
}
