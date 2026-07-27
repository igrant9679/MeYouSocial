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

/** Unipile account types that carry a mailbox. Anything else is a social/IM account. */
const MAIL_TYPES = new Set(["MAIL", "GOOGLE", "GMAIL", "OUTLOOK", "IMAP", "EXCHANGE"]);

/**
 * Mirror this Unipile team's MAILBOXES into a workspace — the reconcile the
 * email side never had.
 *
 * Why it's needed: the only automatic mapping from a Unipile account to a
 * workspace is the `name` field the hosted-auth wizard sets. A mailbox
 * connected directly in Unipile's own dashboard has no such marker, so the app
 * cannot see it at all and reports "no mailbox connected" while mail is sitting
 * there, connected and healthy. That is the exact state this install was in.
 *
 * ⚠ ADOPTION IS DELIBERATELY CONSERVATIVE. Unipile credentials are PLATFORM
 * level — one team serving every tenant — so an unattributed mailbox could
 * belong to any workspace. Accounts already claimed by another workspace are
 * never touched, and everything mirrored here lands in the CALLING workspace,
 * which the action names back to the operator. Guessing silently is how you
 * hand one company's mailbox to another.
 */
export async function syncUnipileMailboxes(
  workspaceId: string,
): Promise<{ found: number; adopted: number; skipped: number; addresses: string[] }> {
  const { listUnipileAccounts } = await import("@/lib/unipile");
  const remote = await listUnipileAccounts();
  const mail = remote.filter((a) => MAIL_TYPES.has(a.type.toUpperCase()));

  const claimedElsewhere = new Set(
    (
      await db.unipileAccount.findMany({
        where: { accountId: { in: mail.map((a) => a.id) }, NOT: { workspaceId } },
        select: { accountId: true },
      })
    ).map((r) => r.accountId),
  );

  let adopted = 0;
  const addresses: string[] = [];
  for (const a of mail) {
    if (claimedElsewhere.has(a.id)) continue;
    await db.unipileAccount.upsert({
      where: { workspaceId_accountId: { workspaceId, accountId: a.id } },
      update: { provider: a.type, name: a.name, status: "connected" },
      create: { workspaceId, accountId: a.id, kind: "email", provider: a.type, name: a.name, status: "connected" },
    });
    adopted++;
    if (a.name) addresses.push(a.name);
  }

  // First mailbox in becomes the default sender, or nothing would send.
  const hasDefault = await db.unipileAccount.findFirst({ where: { workspaceId, kind: "email", isDefault: true } });
  if (!hasDefault) {
    const first = await db.unipileAccount.findFirst({
      where: { workspaceId, kind: "email", status: "connected" },
      orderBy: { createdAt: "asc" },
    });
    if (first) await db.unipileAccount.update({ where: { id: first.id }, data: { isDefault: true } });
  }

  return { found: mail.length, adopted, skipped: claimedElsewhere.size, addresses };
}
