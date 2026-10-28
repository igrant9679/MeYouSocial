import Link from "next/link";
import type { Role } from "@prisma/client";
import { canFollow, roleNeededFor } from "@/lib/role-links";

/**
 * A link that knows who can follow it (SHL-07). For a role that would bounce
 * to /forbidden it renders the label as plain text with whose page it is —
 * or nothing, for a button that only makes sense to someone who can press it.
 * No hooks and no server imports, so client components can use it too.
 */
export function RoleLink({
  href, role, className, children, denied = "text",
}: {
  href: string;
  role: Role;
  className?: string;
  children: React.ReactNode;
  /** "text": the label plus "(an admin's page)"; "hide": nothing. */
  denied?: "text" | "hide";
}) {
  if (canFollow(href, role)) return <Link href={href} className={className}>{children}</Link>;
  if (denied === "hide") return null;
  const whose = roleNeededFor(href) === "ADMIN" ? "an admin's page" : "for editors";
  return (
    <span title={`Only ${roleNeededFor(href) === "ADMIN" ? "an admin" : "an editor or admin"} can open this`}>
      {children}<span className="text-[var(--mute)]"> ({whose})</span>
    </span>
  );
}
