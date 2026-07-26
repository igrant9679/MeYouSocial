import { db } from "@/lib/db";

// DB-side resolver for a workspace's connected Unipile MAILBOX. Kept separate
// from the API client (index.ts) so the client stays a thin HTTP wrapper.
//
// `resolveSocialAccount` used to live here too; it moved to
// src/lib/zernio/accounts.ts with the rest of the social integration.

/** The account a workspace sends email from: its default email account, else the first. */
export async function resolveEmailSender(workspaceId: string): Promise<{ accountId: string; name: string | null } | null> {
  const row = await db.unipileAccount.findFirst({
    where: { workspaceId, kind: "email", status: "connected" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return row ? { accountId: row.accountId, name: row.name } : null;
}
