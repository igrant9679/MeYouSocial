import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";

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

// ── Hosted-auth state ────────────────────────────────────────────────────────
// The hosted-auth callback (/api/unipile/webhook) is public. It used to trust
// the posted `name` as the workspace id and only check that the account existed
// under the shared Unipile key — which another company's real mailbox does — so
// a forged POST could hand one tenant's mailbox to another. Now the link carries
// `<workspaceId>:<nonce>`, the nonce is stored on the workspace for the life of
// the link, and the callback accepts it once.

const HOSTED_STATE_KEY = "unipile:hosted_state";
const HOSTED_STATE_TTL_MS = 45 * 60 * 1000; // the link itself lives 30 minutes

export async function issueHostedAuthState(workspaceId: string): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const nonce = randomBytes(18).toString("base64url");
  await db.workspaceSetting.upsert({
    where: { workspaceId_key: { workspaceId, key: HOSTED_STATE_KEY } },
    update: { value: JSON.stringify({ nonce, exp: Date.now() + HOSTED_STATE_TTL_MS }) },
    create: { workspaceId, key: HOSTED_STATE_KEY, value: JSON.stringify({ nonce, exp: Date.now() + HOSTED_STATE_TTL_MS }) },
  });
  return `${workspaceId}:${nonce}`;
}

/** True once for a `<workspaceId>:<nonce>` this app issued and that hasn't expired. */
export async function consumeHostedAuthState(name: string): Promise<string | null> {
  const sep = name.lastIndexOf(":");
  if (sep <= 0) return null;
  const workspaceId = name.slice(0, sep);
  const nonce = name.slice(sep + 1);
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: HOSTED_STATE_KEY } } });
  if (!row) return null;
  let stored: { nonce?: string; exp?: number } = {};
  try { stored = JSON.parse(row.value) as typeof stored; } catch { return null; }
  if (!stored.nonce || !stored.exp || stored.exp < Date.now()) return null;
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(stored.nonce);
  const b = Buffer.from(nonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Single use: whoever deletes it is the one callback allowed through.
  const gone = await db.workspaceSetting.deleteMany({ where: { workspaceId, key: HOSTED_STATE_KEY, value: row.value } });
  return gone.count === 1 ? workspaceId : null;
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
  opts: { adoptUnclaimed: boolean },
): Promise<{ found: number; adopted: number; skipped: number; unclaimed: number; addresses: string[] }> {
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
  const ownIds = new Set(
    (
      await db.unipileAccount.findMany({ where: { workspaceId, accountId: { in: mail.map((a) => a.id) } }, select: { accountId: true } })
    ).map((r) => r.accountId),
  );

  // ⚠ Only the PLATFORM OPERATOR may adopt a mailbox no workspace claims.
  // A tenant admin's refresh used to take every unclaimed mailbox on the shared
  // team — including one another company had just disconnected — make it the
  // default sender, and list its address back. Tenants now only refresh the
  // mailboxes already theirs; the rest wait for the operator to assign.
  let adopted = 0;
  let unclaimed = 0;
  const addresses: string[] = [];
  for (const a of mail) {
    if (claimedElsewhere.has(a.id)) continue;
    if (!ownIds.has(a.id) && !opts.adoptUnclaimed) { unclaimed++; continue; }
    await db.unipileAccount.upsert({
      where: { workspaceId_accountId: { workspaceId, accountId: a.id } },
      update: { provider: a.type, name: a.name, status: "connected" },
      create: { workspaceId, accountId: a.id, kind: "email", provider: a.type, name: a.name, status: "connected" },
    });
    adopted++;
    if (a.name) addresses.push(a.name);
    // A mailbox new to this workspace is recorded, and every admin told (E-SEC-12).
    if (!ownIds.has(a.id)) await writeAudit({ workspaceId, action: "integration.adopted", entityType: "unipile_account", entityId: a.id, meta: { kind: "mailbox", address: a.name ?? null } });
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

  return { found: mail.length, adopted, skipped: claimedElsewhere.size, unclaimed, addresses };
}
