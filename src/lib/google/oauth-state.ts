import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Single-use `state` for the YouTube and Analytics consent flows.
 *
 * Both used the workspace id as `state`. The callback did check it against the
 * signed-in admin's workspace, but a workspace id is guessable and permanent,
 * so it was no CSRF guard at all: an attacker could finish consent with THEIR
 * Google account and get a victim admin to open
 * `/api/oauth/youtube/callback?code=<theirs>&state=<victim's workspace id>` —
 * binding the attacker's YouTube channel (with upload rights) or Analytics
 * account to the victim's workspace. Same pattern the Drive flow already uses:
 * a random nonce stored server-side, matched once, then burned. 10-minute life.
 *
 * Stored on the workspace (the callback re-derives the workspace from the
 * session, so the nonce only has to prove THIS admin started THIS flow).
 */

type Flow = "youtube" | "analytics";
const TTL_MS = 10 * 60_000;
const key = (flow: Flow) => `oauth_state:${flow}`;

export async function issueOauthState(workspaceId: string, flow: Flow): Promise<string> {
  const nonce = randomBytes(24).toString("base64url");
  const value = `${nonce}.${Date.now() + TTL_MS}`;
  await db.workspaceSetting.upsert({
    where: { workspaceId_key: { workspaceId, key: key(flow) } },
    update: { value },
    create: { workspaceId, key: key(flow), value },
  });
  return nonce;
}

/** True once for the nonce this workspace was issued, within its life. Always burns it. */
export async function consumeOauthState(workspaceId: string, flow: Flow, state: string): Promise<boolean> {
  // Read the row directly (no settings cache — a replica's stale cache would
  // reject a good callback), then delete it whatever the outcome.
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: key(flow) } } });
  if (!row) return false;
  const burned = await db.workspaceSetting.deleteMany({ where: { workspaceId, key: key(flow), value: row.value } });
  if (burned.count !== 1 || !state) return false;
  const [nonce, expiry] = row.value.split(".");
  if (!nonce || Number(expiry) < Date.now()) return false;
  const a = Buffer.from(nonce);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}
