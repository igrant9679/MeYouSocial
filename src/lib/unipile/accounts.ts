import { db } from "@/lib/db";

// DB-side resolvers for a workspace's connected Unipile accounts. Kept separate
// from the API client (index.ts) so the client stays a thin HTTP wrapper.

/** The account a workspace sends email from: its default email account, else the first. */
export async function resolveEmailSender(workspaceId: string): Promise<{ accountId: string; name: string | null } | null> {
  const row = await db.unipileAccount.findFirst({
    where: { workspaceId, kind: "email", status: "connected" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return row ? { accountId: row.accountId, name: row.name } : null;
}

/** The social account for a given network (linkedin/x/instagram/…) in a workspace. */
export async function resolveSocialAccount(workspaceId: string, network: string): Promise<{ accountId: string; name: string | null } | null> {
  const provider = network.toUpperCase();
  const row = await db.unipileAccount.findFirst({
    where: { workspaceId, kind: "social", provider, status: "connected" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return row ? { accountId: row.accountId, name: row.name } : null;
}
