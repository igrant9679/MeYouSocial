import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { SocialSubNav, type SocialNavItem } from "@/components/SocialSubNav";

/**
 * Social workspace shell: every /social page gets the sticky sub-nav with live
 * counts. Full-bleed inside the app main (which pads 24px), hence the negative
 * margins; sticky against the app's scroll container. Mirrors BlogLayout.
 *
 * The badge counts are deliberately CHEAP aggregate queries, not a call into
 * getSocialOverview — this layout runs on every Social page, including the post
 * editor, and the overview reads three hundred posts with their targets.
 */
export default async function SocialLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireMembership();
  const [awaiting, scheduled, failing, broken] = await Promise.all([
    db.socialPost.count({ where: { workspaceId: workspace.id, approval: "pending" } }),
    db.socialPost.count({ where: { workspaceId: workspace.id, status: "scheduled" } }),
    db.socialPost.count({
      where: { workspaceId: workspace.id, targets: { some: { status: "failed" } } },
    }),
    db.zernioAccount.count({ where: { workspaceId: workspace.id, status: { not: "connected" } } }),
  ]);

  // Overview's badge counts DECISIONS, not content: what a person has to act on
  // right now. A neutral total there ("47 posts") tells nobody anything.
  const needsYou = awaiting + failing + broken;

  const items: SocialNavItem[] = [
    { href: "/social", label: "Overview", count: needsYou, urgent: needsYou > 0 },
    { href: "/social/compose", label: "Compose" },
    { href: "/social/calendar", label: "Calendar", count: scheduled },
    { href: "/social/approvals", label: "Approvals", count: awaiting, urgent: awaiting > 0 },
    { href: "/social/performance", label: "Performance" },
    { href: "/social/settings", label: "Settings" },
  ];

  return (
    <div className="-m-6 min-h-full flex flex-col">
      <div className="sticky top-0 z-30">
        <SocialSubNav items={items} />
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
