import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { activeWorkspaceIdFor } from "@/lib/acl";
import { hit, tooMany } from "@/lib/rate-limit";

/**
 * Who is calling /api/v1 (E-SEC-16): a workspace API token —
 * `Authorization: Bearer mys_…` — or, from a browser, the signed-in session.
 * The catalogue promised per-workspace tokens and nothing implemented them.
 *
 * Tokens are 24 random bytes, kept only as a sha256; `scope` read allows GET,
 * write allows GET and POST. A session reads as any member and writes as an
 * editor. Every caller is rate-limited (E-SEC-10): a token by itself, a
 * session by its person.
 */
export const TOKEN_PREFIX = "mys_";

export function newApiToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { raw, hash: hashApiToken(raw), prefix: raw.slice(0, TOKEN_PREFIX.length + 6) };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type ApiCaller = { workspaceId: string; userId: string | null; via: "token" | "session"; tokenId?: string };

function deny(status: number, error: string): { denied: Response } {
  return { denied: Response.json({ error }, { status }) };
}

export async function apiCaller(req: Request, need: "read" | "write"): Promise<{ caller: ApiCaller } | { denied: Response }> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (bearer) {
    if (!bearer.startsWith(TOKEN_PREFIX)) return deny(401, "That isn't a MeYouSocial API token.");
    const token = await db.apiToken.findUnique({ where: { tokenHash: hashApiToken(bearer) } });
    if (!token || token.revokedAt) return deny(401, "That token isn't valid — it may have been revoked.");
    if (need === "write" && token.scope !== "write") return deny(403, "This token can only read.");
    const limited = await hit("apiPerUser", `token:${token.id}`);
    if (!limited.ok) return { denied: tooMany(limited.retryAfter) };
    // last-used, at most once a minute per token
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
      await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return { caller: { workspaceId: token.workspaceId, userId: token.createdById, via: "token", tokenId: token.id } };
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return deny(401, "Sign in, or send an API token as Authorization: Bearer mys_…");
  const workspaceId = await activeWorkspaceIdFor(userId);
  if (!workspaceId) return deny(403, "You aren't a member of a workspace.");
  const membership = await db.membership.findFirst({ where: { userId, workspaceId, status: "active" }, select: { role: true } });
  if (!membership) return deny(403, "You aren't a member of this workspace.");
  if (need === "write" && membership.role === "VIEWER") return deny(403, "Writing needs an editor or an admin.");
  const limited = await hit("apiPerUser", userId);
  if (!limited.ok) return { denied: tooMany(limited.retryAfter) };
  return { caller: { workspaceId, userId, via: "session" } };
}
