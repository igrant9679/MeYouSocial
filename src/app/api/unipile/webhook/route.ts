import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUnipileAccount, classifyAccount } from "@/lib/unipile";

// Unipile hosted-auth callback. On a successful connection Unipile POSTs
// { status: "CREATION_SUCCESS", account_id, name } where name = the workspaceId
// we passed. We map the account to that workspace and store it.
//
// Security: the endpoint is public, but a forged payload can't attach a bogus
// account — we re-fetch the account from Unipile using OUR api key; an id that
// doesn't exist under our account resolves to null and is rejected. We also
// require the named workspace to exist.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let payload: { status?: string; account_id?: string; name?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const status = payload.status ?? "";
  const accountId = payload.account_id ?? "";
  const workspaceId = (payload.name ?? "").trim();

  // Reconnect/other statuses: acknowledge without changes.
  if (status !== "CREATION_SUCCESS" || !accountId || !workspaceId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) return NextResponse.json({ ok: true, ignored: "unknown workspace" });

  // Validate the account really exists under our Unipile key.
  const info = await getUnipileAccount(accountId);
  if (!info || info.id !== accountId) {
    return NextResponse.json({ ok: true, ignored: "account not found" });
  }

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
