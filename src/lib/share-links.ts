import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { safeFetch } from "@/lib/net/safe-fetch";
import { getBrandKit } from "@/lib/motifs";

/**
 * Read-only share links (E-MEA-14): one report, for someone without an
 * account — a client — until it expires or an admin turns it off.
 *
 * The token in the link is `<linkId>.<signature>`, the signature an HMAC of
 * the id under a key derived from AUTH_SECRET (as two-factor's tokens are).
 * Nothing secret is stored: the row only says what is shared, until when, and
 * how often it was opened; an admin can copy the link again at any time
 * because it's recomputed. ⚠ Rotating AUTH_SECRET turns every link off.
 * ⚠ A link shows ONE report, read-only — never the app, never another report.
 */

export const SHARE_DAYS = [7, 30, 90] as const;

function signature(id: string): string {
  return createHmac("sha256", `share:${env.AUTH_SECRET}`).update(id).digest("base64url").slice(0, 32);
}

/** The token for a link id. */
export function shareToken(id: string): string {
  return `${id}.${signature(id)}`;
}

/** The link id a token names, if its signature holds. Pure apart from the key. */
export function verifyShareToken(token: string): string | null {
  if (!env.AUTH_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const want = signature(id);
  if (sig.length !== want.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}

export type OpenShare = { id: string; workspaceId: string; workspaceName: string; kind: string; targetKey: string; label: string | null; expiresAt: Date };

/** The live link a token opens — null when the signature is wrong, the link was turned off, or it expired. */
export async function openShare(token: string): Promise<OpenShare | null> {
  const id = verifyShareToken(token);
  if (!id) return null;
  const link = await db.shareLink.findUnique({ where: { id }, include: { workspace: { select: { name: true, deletedAt: true } } } });
  if (!link || link.revokedAt || link.expiresAt <= new Date() || link.workspace.deletedAt) return null;
  return { id: link.id, workspaceId: link.workspaceId, workspaceName: link.workspace.name, kind: link.kind, targetKey: link.targetKey, label: link.label, expiresAt: link.expiresAt };
}

export type Branding = { name: string; color: string; logo: Buffer | null };

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The workspace's own look for what a client sees: its name, its primary
 * colour (hex-checked; else a neutral ink), and its logo as PNG bytes — read
 * through storage (our URLs are session-gated) or fetched from a public host,
 * converted by sharp so any format works, capped in size. No logo → none.
 */
export async function brandingFor(workspaceId: string, workspaceName: string): Promise<Branding> {
  const kit = await getBrandKit(workspaceId).catch(() => null);
  const color = kit?.primaryColor && HEX.test(kit.primaryColor) ? kit.primaryColor : "#15181D";
  let logo: Buffer | null = null;
  const url = kit?.logoUrl?.trim();
  if (url) {
    try {
      let bytes: Buffer | null = null;
      const local = url.match(/^\/(?:uploads|api\/files)\/(.+)$/);
      if (local) bytes = await storage.get(decodeURIComponent(local[1]));
      else if (/^https?:\/\//i.test(url)) {
        const res = await safeFetch(url, { signal: AbortSignal.timeout(10_000) });
        if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
      }
      // ⚠ sharp loads on use, as everywhere else here: a top-level import put a
      // second libvips in the build's prerender worker beside Next's own, and the
      // icon route failed with GLib "invalid property" errors.
      const sharp = (await import("sharp")).default;
      if (bytes && bytes.byteLength < 5 * 1024 * 1024) logo = await sharp(bytes).resize({ width: 600, height: 240, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      logo = null;
    }
  }
  return { name: workspaceName, color, logo };
}
