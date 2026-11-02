import { getSetting } from "@/lib/settings";

/**
 * Approval workflow resolution for a post being created or resubmitted.
 *
 * When `social:require_approval` is on, a non-admin's post carries
 * approval="pending" and is HELD AS A DRAFT whatever send option they chose —
 * the requested time is kept on scheduledAt so approving can honor it. Admins'
 * own posts are stamped "approved" so the UI can say so. With the workflow
 * off, approval stays null and nothing changes.
 */
export async function resolveApprovalForCreate(
  workspaceId: string, role: string,
): Promise<{ requireApproval: boolean; approval: string | null; held: boolean }> {
  const requireApproval = (await getSetting("social:require_approval", workspaceId).catch(() => "")) === "true";
  if (!requireApproval) return { requireApproval, approval: null, held: false };
  const held = role !== "ADMIN";
  return { requireApproval, approval: held ? "pending" : "approved", held };
}
