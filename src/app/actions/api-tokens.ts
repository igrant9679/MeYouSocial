"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { newApiToken } from "@/lib/api-auth";

// Workspace API tokens (E-SEC-16) — an admin's. The token itself is returned
// ONCE, to the form that asked (useActionState), never put in a URL or stored.

export type CreateTokenState = { token?: string; name?: string; error?: string } | null;

export async function createApiTokenAction(_prev: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  const { workspace, user } = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const scope = formData.get("scope") === "write" ? "write" : "read";
  if (!name) return { error: "Name the token after what will use it." };
  const live = await db.apiToken.count({ where: { workspaceId: workspace.id, revokedAt: null } });
  if (live >= 20) return { error: "This workspace has 20 live tokens — revoke one first." };
  const t = newApiToken();
  const row = await db.apiToken.create({ data: { workspaceId: workspace.id, name, prefix: t.prefix, tokenHash: t.hash, scope, createdById: user.id } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "api_token.created", entityType: "api_token", entityId: row.id, meta: { name, scope, prefix: t.prefix } });
  revalidatePath("/admin/api-tokens");
  return { token: t.raw, name };
}

export async function revokeApiTokenAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const token = await db.apiToken.findFirst({ where: { id, workspaceId: workspace.id, revokedAt: null } });
  if (!token) return;
  await db.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "api_token.revoked", entityType: "api_token", entityId: token.id, meta: { name: token.name, prefix: token.prefix } });
  revalidatePath("/admin/api-tokens");
}
