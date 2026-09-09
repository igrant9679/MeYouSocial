import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * The active channel, as the assistant should know it — the preamble the old
 * Research chat (MU-07, retired 2026-09-09) built for every reply: niche,
 * differentiation, the audience's key questions, the default voice profile,
 * the channel's durable memory and its starred research. Folded into the
 * assistant so "my channel" means something on every page, and so video ideas
 * and scripts land on the right channel without being asked.
 */
export async function channelBrief(workspaceId: string, channelId: string | null | undefined): Promise<string | null> {
  if (!channelId) return null;
  const ch = await db.channel.findFirst({
    where: { id: channelId, workspaceId },
    include: {
      voiceProfiles: { where: { isDefault: true }, take: 1 },
      audience: true,
      memory: { orderBy: { createdAt: "asc" }, take: 30 },
      research: { where: { starred: true }, take: 6, orderBy: { createdAt: "desc" } },
    },
  });
  if (!ch) return null;
  const voice = ch.voiceProfiles[0];
  const keyQuestions = readJson<string[]>(ch.audience?.keyQuestions ?? null, []);
  const lines = [
    `Active YouTube channel: "${ch.name}" (id ${ch.id}). When the person says "my channel", "this channel" or asks for video ideas or a script without naming a channel, it is this one.`,
    ch.nicheDescription ? `Niche: ${ch.nicheDescription.slice(0, 400)}` : "",
    ch.differentiation ? `Differentiation: ${ch.differentiation.slice(0, 300)}` : "",
    keyQuestions.length ? `Audience key questions: ${keyQuestions.slice(0, 5).join(" · ")}` : "",
    voice?.data ? `Voice profile (truncated): ${voice.data.slice(0, 600)}` : "",
    ch.memory.length ? `Channel memory (durable facts — always respect these):\n${ch.memory.map((m) => `- ${m.body.slice(0, 200)}`).join("\n")}` : "",
    ch.research.length ? `Starred research:\n${ch.research.map((r) => `### ${r.title ?? r.ref}\n${(r.content ?? "").slice(0, 500)}`).join("\n\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Pull a YouTube video id out of a URL or a bare id. */
export function youtubeVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** A page as text: title + body, scripts and styles removed, whitespace collapsed. */
export async function fetchPageText(url: string, maxChars = 6000): Promise<{ ok: true; title: string; text: string; chars: number } | { ok: false; reason: string }> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "only http(s) pages" };
  const host = u.hostname.toLowerCase();
  // The server fetches on the person's behalf; keep it off the private network.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { ok: false, reason: "that address is not reachable from here" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; MeYouSocial Publish assistant)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } });
    if (!res.ok) return { ok: false, reason: `the page answered ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return { ok: false, reason: `not a readable page (${type.split(";")[0] || "unknown type"})` };
    const raw = (await res.text()).slice(0, 1_500_000);
    const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const body = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(?:nav|footer|header|aside)[\s\S]*?<\/(?:nav|footer|header|aside)>/gi, " ")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { ok: true, title, text: body.slice(0, maxChars), chars: body.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "AbortError" ? "the page took too long" : "could not fetch the page" };
  } finally {
    clearTimeout(timer);
  }
}
