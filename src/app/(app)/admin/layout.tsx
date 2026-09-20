import { requireRole } from "@/lib/acl";

// ⚠ The admin pages no longer bring their own tab strip (audit B1.4). They are
// tabs of Settings now — the StageStrip in the app shell renders them, because
// stageFor() maps /admin/* to "/setup". AdminSubNav was the SECOND strip on
// these pages and is gone; the files stayed exactly where they were, since
// around thirty actions redirect to /admin/* URLs.
//
// requireRole("ADMIN") stays: it is the real server gate. The strip's `admin`
// flag only decides whether the tabs are OFFERED.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return <div>{children}</div>;
}
