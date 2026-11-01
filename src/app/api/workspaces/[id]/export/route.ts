import { Prisma } from "@prisma/client";
import { baseDb } from "@/lib/db";
import { getCurrentUser, isPlatformOperator } from "@/lib/acl";
import { isSecretSetting } from "@/lib/keyring";
import { writeAudit } from "@/lib/governance";

/**
 * Everything a workspace holds, as one JSON download (E-SEC-14) — for its admins
 * before they delete it, and for the platform operator during the restore window
 * (a deleted workspace is no one else's to open). Every table with a
 * `workspaceId`, plus the rows of its channels; secrets are never in it: key and
 * password values, token hashes, two-factor secrets, OAuth tokens. Streamed a
 * table at a time so a large workspace doesn't sit in memory.
 */

export const dynamic = "force-dynamic";

const DROP_FIELD = /^(passwordHash|totpSecret|totpRecovery|tokenHash|encAppPassword|refresh_token|access_token|id_token|sessionToken)$|secret/i;
// Caches and queues are rebuilt by the app; they aren't the company's content.
const SKIP_MODEL = /Cache$|^Job$/;
const PAGE = 500;

type Model = { name: string; fields: readonly { name: string; kind: string }[] };

function delegate(name: string) {
  return (baseDb as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[name[0].toLowerCase() + name.slice(1)];
}

function replacer(_k: string, v: unknown) {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  return v;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const ws = await baseDb.workspace.findUnique({ where: { id } });
  const admin = user.memberships.some((m) => m.workspaceId === id && m.status === "active" && m.role === "ADMIN");
  // The same answer for "no such workspace" and "not yours".
  if (!ws || !(admin || isPlatformOperator(user.email))) return Response.json({ error: "Not found." }, { status: 404 });

  await writeAudit({ workspaceId: id, actorId: user.id, action: "workspace.exported", entityType: "workspace", entityId: id, meta: { deleted: !!ws.deletedAt } });

  const models = (Prisma.dmmf.datamodel.models as unknown as Model[]).filter((m) => !SKIP_MODEL.test(m.name) && m.name !== "Workspace");
  const scalars = (m: Model) => m.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name);
  const channelIds = (await baseDb.channel.findMany({ where: { workspaceId: id }, select: { id: true } })).map((c) => c.id);
  const plan = models.flatMap((m) => {
    const cols = scalars(m);
    if (cols.includes("workspaceId")) return [{ m, where: { workspaceId: id } as Record<string, unknown>, cols }];
    if (cols.includes("channelId") && channelIds.length) return [{ m, where: { channelId: { in: channelIds } }, cols }];
    return [];
  });

  const enc = new TextEncoder();
  const head = {
    format: "meyousocial-workspace-export/1",
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    workspace: ws,
    notes: [
      "Every table with a workspaceId, and the rows of the workspace's channels. Caches and the job queue are left out.",
      "Secrets are never exported: API key and password values, token hashes, two-factor secrets and OAuth tokens are removed; secret settings say \"[not exported]\".",
    ],
  };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const h = JSON.stringify(head, replacer);
      c.enqueue(enc.encode(`${h.slice(0, -1)},"tables":{`));
    },
    async pull(c) {
      if (i >= plan.length) { c.enqueue(enc.encode("}}\n")); c.close(); return; }
      const { m, where, cols } = plan[i];
      const keep = cols.filter((n) => !DROP_FIELD.test(n));
      const select = Object.fromEntries(keep.map((n) => [n, true]));
      if (m.name === "Membership") Object.assign(select, { user: { select: { email: true, name: true } } });
      c.enqueue(enc.encode(`${i ? "," : ""}${JSON.stringify(m.name)}:[`));
      for (let skip = 0, first = true; ; skip += PAGE) {
        // a stable order, so pages don't overlap or skip
        const orderBy = cols.includes("id") ? { id: "asc" } : cols.includes("key") ? { key: "asc" } : undefined;
        const rows = await delegate(m.name).findMany({ where, select, skip, take: PAGE, ...(orderBy ? { orderBy } : {}) });
        for (const r of rows) {
          if (m.name === "WorkspaceSetting" && typeof r.key === "string" && (isSecretSetting(r.key) || r.key.endsWith(":refresh_token"))) r.value = "[not exported]";
          c.enqueue(enc.encode(`${first ? "" : ","}${JSON.stringify(r, replacer)}`));
          first = false;
        }
        if (rows.length < PAGE) break;
      }
      c.enqueue(enc.encode("]"));
      i++;
    },
  });
  const slug = ws.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  return new Response(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
