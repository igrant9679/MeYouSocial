"use server";

import { requireRole } from "@/lib/acl";
import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { parseSocialHead } from "@/lib/live-head";
import { hit } from "@/lib/rate-limit";

/**
 * The card a link becomes on the networks that draw one (X, LinkedIn, Facebook, Threads, Telegram, WhatsApp, Discord,
 * Reddit) — for the composer's "Preview as posted" (2026-11-21). The networks build it from the linked page's own
 * og:image / og:title / og:description, so that is what is read here: the page itself, through safeFetch (a person
 * typed the address — every hop must be public), only its <head>, at most 512 KB.
 *
 * ⚠ Read-only and best-effort: a page that can't be read gives a card with the address alone, and nothing is stored.
 * The networks read the page again when the post goes out — and may cache an older copy for days — so the preview
 * says the card is the page as it reads now.
 */

export type LinkCard = {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

export type LinkCardResult = { ok: true; card: LinkCard; note?: string } | { ok: false; error: string };

const cache = new Map<string, { at: number; card: LinkCard }>();
const TTL_MS = 15 * 60_000;
const MAX_BYTES = 512 * 1024;

const clean = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};

/** Read the start of a response body, stopping at </head> or MAX_BYTES. */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return html;
}

export async function linkCardAction(raw: string): Promise<LinkCardResult> {
  const { user } = await requireRole("EDITOR");
  const input = String(raw ?? "").trim().slice(0, 2000);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "That isn't a valid link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Only http and https links make a card." };
  const domain = url.hostname.replace(/^www\./i, "");
  const key = url.toString();
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < TTL_MS) return { ok: true, card: kept.card };

  const limit = await hit("linkCardsPerUser", user.id);
  if (!limit.ok) return { ok: true, card: { url: key, domain, title: null, description: null, image: null, siteName: null }, note: `Too many links read just now — try again in ${limit.retryAfter} s.` };

  try {
    const res = await safeFetch(key, {
      headers: {
        // Many sites only print their share tags for a crawler they recognise; this one says what it is.
        "user-agent": "Mozilla/5.0 (compatible; MeYouSocialPreview/1.0; link card for a post being written)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html|xml/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      const card: LinkCard = { url: key, domain, title: null, description: null, image: null, siteName: null };
      return { ok: true, card, note: res.ok ? "The link isn't a web page, so the networks show just the address." : `The page answered ${res.status}, so the networks would show just the address — check the link.` };
    }
    const head = parseSocialHead(await readHead(res));
    const finalUrl = res.url || key;
    const abs = (u: string | null) => {
      if (!u) return null;
      try {
        const a = new URL(u, finalUrl);
        return a.protocol === "https:" || a.protocol === "http:" ? a.toString() : null;
      } catch {
        return null;
      }
    };
    const card: LinkCard = {
      url: key,
      domain,
      title: clean(head.ogTitle ?? head.title, 200),
      description: clean(head.ogDescription, 300),
      image: abs(head.ogImage ?? head.twitterImage),
      siteName: clean(head.ogSiteName, 80),
    };
    if (cache.size > 300) cache.clear();
    cache.set(key, { at: Date.now(), card });
    return { ok: true, card, note: card.image ? undefined : "The page names no share picture (og:image), so the card has none." };
  } catch (e) {
    const card: LinkCard = { url: key, domain, title: null, description: null, image: null, siteName: null };
    const why = e instanceof UnsafeUrlError ? e.message : e instanceof Error && e.name === "TimeoutError" ? "The page took too long to answer." : "The page couldn't be read.";
    return { ok: true, card, note: `${why} The card shows the address only.` };
  }
}
