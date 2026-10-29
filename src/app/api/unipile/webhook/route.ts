import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUnipileAccount, classifyAccount } from "@/lib/unipile";
import { consumeHostedAuthState } from "@/lib/unipile/accounts";

// Unipile hosted-auth callback. On a successful connection Unipile POSTs
// { status: "CREATION_SUCCESS", account_id, name } where name is the
// `<workspaceId>:<nonce>` connectAccountAction put on the link.
//
// Security: the endpoint is public, so nothing in the payload is trusted on its
// own.
// - The name must be a state this app issued, unexpired, and it works ONCE
//   (consumeHostedAuthState). It used to be the bare workspace id, so a forged
//   POST could attach any mailbox to any workspace.
// - The account is re-fetched from Unipile with OUR key; an id that doesn't
//   exist under our account is rejected.
// - An account another workspace already owns is never re-assigned here —
//   that decision belongs to the platform operator.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // E-SEC-10: a flood of forged deliveries is cut off before any secret is checked.
  const { hit, ipFrom, tooMany } = await import("@/lib/rate-limit");
  const limited = await hit("webhookPerIp", ipFrom(req.headers));
  if (!limited.ok) return tooMany(limited.retryAfter);
  let payload: { status?: string; account_id?: string; name?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const status = payload.status ?? "";
  const accountId = payload.account_id ?? "";
  const name = (payload.name ?? "").trim();

  // Reconnect/other statuses: acknowledge without changes.
  if (status !== "CREATION_SUCCESS" || !accountId || !name) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Validate the account really exists under our Unipile key BEFORE spending
  // the single-use state, so a junk POST can't burn a person's live link.
  const info = await getUnipileAccount(accountId);
  if (!info || info.id !== accountId) {
    return NextResponse.json({ ok: true, ignored: "account not found" });
  }

  const owner = await db.unipileAccount.findFirst({ where: { accountId }, select: { workspaceId: true } });

  const workspaceId = await consumeHostedAuthState(name);
  if (!workspaceId) return NextResponse.json({ ok: true, ignored: "unrecognised or expired state" });
  if (owner && owner.workspaceId !== workspaceId) {
    return NextResponse.json({ ok: true, ignored: "account belongs to another workspace" });
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) return NextResponse.json({ ok: true, ignored: "unknown workspace" });

  const { kind, provider } = classifyAccount(info.type);
  await db.unipileAccount.upsert({
    where: { workspaceId_accountId: { workspaceId, accountId } },
    update: { kind, provider, name: info.name, status: "connected" },
    create: { workspaceId, accountId, kind, provider, name: info.name, status: "connected" },
  });

  return NextResponse.json({ ok: true });
}

// Unipile may probe the URL with a GET; answer 200 so it validates.
export async function GET() {
  return NextResponse.json({ ok: true, service: "unipile-webhook" });
}
