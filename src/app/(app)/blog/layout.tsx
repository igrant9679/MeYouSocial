import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { BlogSubNav, type BlogNavItem } from "@/components/BlogSubNav";

/**
 * Blog workspace shell: every /blog page gets the sticky sub-nav with live
 * counts. Full-bleed inside the app main (which pads 24px), hence the negative
 * margins; sticky against the app's scroll container.
 */
export default async function BlogLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireMembership();
  const [needsYou, ideasOpen, auditOpen] = await Promise.all([
    db.blogPost.count({ where: { workspaceId: workspace.id, status: { in: ["draft_review", "final_approval"] } } }),
    db.blogIdea.count({ where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] } } }),
    db.contentAuditItem.count({ where: { workspaceId: workspace.id, status: "open", recommendation: { not: "keep" } } }),
  ]);

  const items: BlogNavItem[] = [
    { href: "/blog", label: "Posts", count: needsYou, urgent: needsYou > 0 },
    { href: "/blog/ideas", label: "Ideas", count: ideasOpen },
    { href: "/blog/keywords", label: "Keywords" },
    { href: "/blog/experts", label: "Experts" },
    { href: "/blog/audit", label: "Audit", count: auditOpen },
    { href: "/blog/analytics", label: "Analytics" },
    { href: "/blog/report", label: "Report" },
    { href: "/blog/automation", label: "Automation" },
    { href: "/blog/brand", label: "Brand" },
    { href: "/blog/organization", label: "Organization" },
    { href: "/blog/settings", label: "Settings" },
  ];

  return (
    <div className="-m-6 min-h-full flex flex-col">
      <div className="sticky top-0 z-30">
        <BlogSubNav items={items} />
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
