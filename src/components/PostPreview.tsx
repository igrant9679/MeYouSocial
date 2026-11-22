"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  X as Close, Heart, MessageCircle, MessageSquare, Repeat2, Send, Bookmark, Share, Share2, BarChart2, ThumbsUp, Globe,
  MoreHorizontal, ArrowBigUp, ArrowBigDown, Music2, Smartphone, Monitor, Loader2, Eye,
} from "lucide-react";
import {
  skinForFormat, richParts, displayLink, firstLink, domainOf, untagged, foldCaption, feedAspect, type Skin,
} from "@/lib/social/preview-skins";
import { networkFor } from "@/lib/social/networks";
import { lengthNote, postLength } from "@/lib/social/text-length";
import { linkCardAction, type LinkCard } from "@/app/actions/social-links";

/**
 * "Preview as posted" (2026-11-21, the owner: "click to preview it so I see exactly what it looks like as posted on
 * the social account"). One tab per network, each drawn the way that network's feed draws a post — its colours and
 * type, the caption folded where it folds behind "more", links and hashtags the way it writes them, pictures cropped
 * to its shapes, a bare link turned into the page's card where it makes one, the first comment under the post.
 *
 * ⚠ It is handed the text AS SENT (the composer's `sendFor`: links tagged, links moved to the first comment), so what
 * it shows is what goes out; the look itself is data in lib/social/preview-skins.ts. The network draws the final
 * pixels — fonts, a cached card — which the footnote says once, plainly.
 */

export type PreviewMedia = { url: string; video: boolean };
export type PreviewPost = {
  /** Zernio slug, any case. */
  provider: string;
  accountName: string | null;
  handle: string | null;
  /** The caption as it will be sent. */
  text: string;
  /** The first comment as it will be posted, or null. */
  comment: string | null;
  media: PreviewMedia[];
  /** "story" | "reel" | null. */
  subFormat: string | null;
  /** True when no account on this network is ticked yet — shown, but marked. */
  unselected?: boolean;
};

type CardState = { state: "loading" } | { state: "done"; card: LinkCard; note?: string };

/** A button that opens the window — for a saved post's own page, where the posts are built on the server. */
export function PostPreviewButton({ posts, avatarUrl, brandName, sent }: { posts: PreviewPost[]; avatarUrl: string | null; brandName: string; sent: boolean }) {
  const [open, setOpen] = useState(false);
  if (!posts.length) return null;
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)} data-preview-open-post>
        <Eye className="w-3.5 h-3.5" /> Preview as posted
      </button>
      {open && <PostPreviewDialog posts={posts} avatarUrl={avatarUrl} brandName={brandName} sent={sent} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PostPreviewDialog({
  posts,
  avatarUrl,
  brandName,
  sent = false,
  onClose,
}: {
  posts: PreviewPost[];
  avatarUrl: string | null;
  brandName: string;
  /** The post has gone out: the footnote says what was sent, not what will be. */
  sent?: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [wide, setWide] = useState(false);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const post = posts[Math.min(tab, posts.length - 1)];

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, [onClose]);

  // The link card for this tab, read once per link (the page as it reads now).
  const wantsCard = post && post.media.length === 0 && skinForFormat(post.provider, post.subFormat).linkCard !== "no";
  const link = post ? firstLink(post.text) : null;
  const cardKey = link ? untagged(link) : null;
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!wantsCard || !cardKey || asked.current.has(cardKey)) return;
    asked.current.add(cardKey);
    const bare: LinkCard = { url: cardKey, domain: domainOf(cardKey), title: null, description: null, image: null, siteName: null };
    linkCardAction(cardKey)
      .then((r) => setCards((c) => ({ ...c, [cardKey]: r.ok ? { state: "done", card: r.card, note: r.note } : { state: "done", card: bare, note: r.error } })))
      .catch(() => setCards((c) => ({ ...c, [cardKey]: { state: "done", card: bare, note: "The page couldn't be read." } })));
  }, [wantsCard, cardKey]);

  if (!post) return null;
  const skin = skinForFormat(post.provider, post.subFormat);
  const card = wantsCard && cardKey ? cards[cardKey] ?? { state: "loading" as const } : null;
  const vertical = skin.layout === "vertical";
  // Counted the way the network counts (X weights links and wide characters), the same count the composer and the send use.
  const limit = networkFor(post.provider)?.charLimit ?? 3000;
  const over = postLength(post.provider, post.text) - limit;
  const weightedNote = lengthNote(post.provider);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Preview as posted" data-post-preview>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative card !p-0 w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)]">
          <Eye className="w-4 h-4 text-[var(--mute)]" />
          <h2 className="font-mono font-bold text-sm">Preview as posted</h2>
          <span className="flex-1" />
          <div className="inline-flex rounded-lg border border-[var(--line-2)] overflow-hidden" role="group" aria-label="Width">
            <button type="button" onClick={() => setWide(false)} className="px-2 py-1 text-2xs inline-flex items-center gap-1" style={!wide ? { background: "var(--accent-soft)", color: "var(--accent-on)" } : undefined} aria-pressed={!wide}>
              <Smartphone className="w-3.5 h-3.5" /> Phone
            </button>
            <button type="button" onClick={() => setWide(true)} className="px-2 py-1 text-2xs inline-flex items-center gap-1 border-l border-[var(--line-2)]" style={wide ? { background: "var(--accent-soft)", color: "var(--accent-on)" } : undefined} aria-pressed={wide}>
              <Monitor className="w-3.5 h-3.5" /> Wide
            </button>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn sm !px-1.5" aria-label="Close the preview"><Close className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 px-3 py-2 border-b border-[var(--line)] overflow-x-auto" role="tablist" aria-label="Networks">
          {posts.map((p, i) => {
            const net = networkFor(p.provider);
            const on = i === tab;
            return (
              <button key={`${p.provider}-${i}`} type="button" role="tab" aria-selected={on} onClick={() => setTab(i)} data-preview-tab={p.provider.toLowerCase()}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold"
                style={on ? { borderColor: net?.color ?? "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)" } : { borderColor: "var(--line-2)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                {skinForFormat(p.provider, p.subFormat).label}{p.subFormat ? ` ${p.subFormat === "story" ? "Story" : "Reel"}` : ""}
                {p.unselected && <span className="font-normal text-[var(--mute)]">· not ticked</span>}
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-auto p-3 sm:p-5" style={{ background: "var(--zebra)" }}>
          {over > 0 && (
            <p className="mx-auto mb-2 text-xs rounded-lg px-3 py-2" style={{ maxWidth: vertical ? 360 : wide ? 600 : 400, background: "var(--rose-soft)", color: "var(--rose-on)" }} role="alert" data-preview-over>
              {skin.label} takes {limit} characters{weightedNote ? ` (${weightedNote})` : ""}; this is {limit + over}. It won&apos;t send there until it&apos;s {over} shorter. Customize it for {skin.label} or trim the base post.
            </p>
          )}
          <div className="mx-auto" style={{ width: vertical ? 360 : wide ? 600 : 400, maxWidth: "100%" }} data-preview-network={post.provider.toLowerCase()}>
            <NetworkPost key={`${post.provider}-${tab}`} post={post} skin={skin} avatarUrl={avatarUrl} brandName={brandName} card={card} />
          </div>
        </div>
        <p className="px-3 py-2 border-t border-[var(--line)] text-micro text-[var(--mute)]">
          {sent
            ? <>Drawn the way {skin.label} lays out a post, from what was sent to it — links tagged with today&apos;s link settings, the first comment where it went. {skin.label} drew the real post in its own fonts{card ? ", with the card it read from the page then" : ""}.</>
            : <>Drawn the way {skin.label} lays out a post, from exactly what will be sent — links as tagged, the first comment where it goes. {skin.label} draws the final pixels in its own fonts{card ? ", and builds the link card from the page when the post goes out (it may keep an older copy of the page for a while)" : ""}.</>}
          {post.unselected ? " No account on this network is ticked, so this post won't go here unless you tick one." : ""}
        </p>
      </div>
    </div>
  );
}

// ── Pieces every network shares ──────────────────────────────────────────────

function Avatar({ url, name, size, skin, color }: { url: string | null; name: string; size: number; skin: Skin; color: string }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: skin.avatar === "circle" ? "9999px" : Math.round(size / 8), flexShrink: 0 };
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" style={{ ...style, objectFit: "cover", background: skin.panel }} />;
  return (
    <span className="grid place-items-center font-bold" style={{ ...style, background: color, color: "white", fontSize: Math.round(size * 0.42) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The caption, coloured the way the network colours links, hashtags and @mentions. */
function Rich({ text, skin }: { text: string; skin: Skin }) {
  const parts = richParts(text);
  const firstTag = parts.findIndex((p) => p.kind === "tag");
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "link") return skin.linksLive ? <span key={i} style={{ color: skin.link }}>{displayLink(p.text, skin)}</span> : <span key={i}>{p.text}</span>;
        if (p.kind === "tag") {
          const live = !skin.firstTagOnly || i === firstTag;
          return live ? <span key={i} style={{ color: skin.tag, fontWeight: skin.tagsBold ? 600 : undefined }}>{p.text}</span> : <span key={i}>{p.text}</span>;
        }
        if (p.kind === "mention") return <span key={i} style={{ color: skin.tag, fontWeight: skin.tagsBold ? 600 : undefined }}>{p.text}</span>;
        return <span key={i}>{p.text}</span>;
      })}
    </>
  );
}

/** The caption folded where the network folds it; "more" opens the rest, as on the network. */
function Caption({ text, skin, lead, className, style }: { text: string; skin: Skin; lead?: ReactNode; className?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const { shown, folded } = open ? { shown: text, folded: false } : foldCaption(text, skin.fold);
  if (!text && !lead) return null;
  return (
    <div className={`whitespace-pre-wrap break-words ${className ?? ""}`} style={{ fontSize: skin.size ?? 15, lineHeight: 1.35, ...style }} data-preview-caption>
      {lead}
      <Rich text={shown} skin={skin} />
      {folded && (
        <>
          {skin.fold!.more.startsWith("…") ? "" : "… "}
          <button type="button" onClick={() => setOpen(true)} style={{ color: skin.mute, fontWeight: 600 }} data-preview-more>{skin.fold!.more}</button>
        </>
      )}
    </div>
  );
}

/** One picture or video, cropped to the network's shapes. */
function Shot({ m, skin, aspect, fill }: { m: PreviewMedia; skin: Skin; aspect?: number; fill?: boolean }) {
  const [natural, setNatural] = useState<number | null>(null);
  const ratio = aspect ?? feedAspect(natural, skin);
  const style: CSSProperties = fill ? { width: "100%", height: "100%", objectFit: "cover", display: "block" } : { width: "100%", aspectRatio: String(ratio), objectFit: "cover", display: "block", background: "black" };
  return m.video ? (
    <video src={m.url} muted controls playsInline preload="metadata" style={style} onLoadedMetadata={(e) => setNatural(e.currentTarget.videoWidth / (e.currentTarget.videoHeight || 1))} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt="" style={style} onLoad={(e) => setNatural(e.currentTarget.naturalWidth / (e.currentTarget.naturalHeight || 1))} />
  );
}

/** Several pictures: a grid in the post, or a carousel showing the first with dots. */
function MediaBlock({ items, skin, radius = 0, border }: { items: PreviewMedia[]; skin: Skin; radius?: number; border?: boolean }) {
  if (!items.length) return null;
  const frame: CSSProperties = { borderRadius: radius, overflow: "hidden", border: border ? `1px solid ${skin.line}` : undefined };
  if (items.length === 1) return <div style={frame}><Shot m={items[0]} skin={skin} /></div>;
  if (skin.multi === "carousel") {
    return (
      <div>
        <div style={{ ...frame, position: "relative" }}>
          <Shot m={items[0]} skin={skin} />
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-2xs font-semibold" style={{ background: "rgba(0,0,0,0.6)", color: "white" }}>1/{items.length}</span>
        </div>
        <div className="flex justify-center gap-1 py-2">
          {items.map((_, i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === 0 ? skin.tag : skin.line }} />)}
        </div>
      </div>
    );
  }
  const shown = items.slice(0, 4);
  return (
    <div style={{ ...frame, display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr", gridTemplateRows: shown.length > 2 ? "1fr 1fr" : "1fr", aspectRatio: shown.length === 2 ? "16 / 9" : "16 / 10" }}>
      {shown.map((m, i) => (
        <div key={i} style={{ gridRow: shown.length === 3 && i === 0 ? "span 2" : undefined, overflow: "hidden", background: "black" }}>
          <Shot m={m} skin={skin} fill />
        </div>
      ))}
    </div>
  );
}

/** The card a bare link becomes, in the network's own shape. */
function LinkCardView({ card, skin, provider }: { card: CardState; skin: Skin; provider: string }) {
  if (card.state === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-6 justify-center text-xs" style={{ border: `1px solid ${skin.line}`, borderRadius: 12, color: skin.mute }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the linked page for its card…
      </div>
    );
  }
  const c = card.card;
  const title = c.title ?? c.url;
  // eslint-disable-next-line @next/next/no-img-element
  const img = (ratio = 1.91) => (c.image ? <img src={c.image} alt="" referrerPolicy="no-referrer" style={{ width: "100%", aspectRatio: String(ratio), objectFit: "cover", display: "block", background: skin.panel }} /> : null);
  const slug = provider.toLowerCase();
  let body: ReactNode;
  if (slug === "twitter") {
    body = c.image ? (
      <div>
        <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", border: `1px solid ${skin.line}` }}>
          {img()}
          <span className="absolute left-3 bottom-3 px-1.5 py-0.5 rounded text-xs truncate max-w-[85%]" style={{ background: "rgba(0,0,0,0.77)", color: "white" }}>{title}</span>
        </div>
        <div className="text-xs mt-1" style={{ color: skin.mute }}>From {c.domain}</div>
      </div>
    ) : (
      <div className="flex items-stretch" style={{ borderRadius: 16, overflow: "hidden", border: `1px solid ${skin.line}` }}>
        <div className="grid place-items-center w-24 shrink-0" style={{ background: skin.panel, color: skin.mute }}><Globe className="w-6 h-6" /></div>
        <div className="px-3 py-2 min-w-0 text-sm" style={{ borderLeft: `1px solid ${skin.line}` }}>
          <div className="truncate" style={{ color: skin.mute }}>{c.domain}</div>
          <div className="truncate">{title}</div>
          {c.description && <div className="line-clamp-2" style={{ color: skin.mute }}>{c.description}</div>}
        </div>
      </div>
    );
  } else if (skin.layout === "chat") {
    body = (
      <div className="mt-1 pl-2.5 py-1 pr-2 rounded" style={{ borderLeft: `3px solid ${skin.link}`, background: slug === "discord" ? skin.panel : "rgba(0,0,0,0.04)" }}>
        {c.siteName && <div className="text-xs font-semibold" style={{ color: slug === "discord" ? skin.mute : skin.link }}>{c.siteName}</div>}
        <div className="text-sm font-semibold" style={{ color: slug === "discord" ? skin.link : skin.ink }}>{title}</div>
        {c.description && <div className="text-xs line-clamp-3" style={{ color: slug === "discord" ? skin.ink : skin.mute }}>{c.description}</div>}
        {c.image && <div className="mt-1.5 rounded overflow-hidden">{img()}</div>}
      </div>
    );
  } else if (slug === "facebook") {
    body = (
      <div>
        {img()}
        <div className="px-3 py-2" style={{ background: skin.panel }}>
          <div className="text-xs uppercase truncate" style={{ color: skin.mute }}>{c.domain}</div>
          <div className="font-semibold line-clamp-2" style={{ fontSize: 16 }}>{title}</div>
          {c.description && <div className="text-sm truncate" style={{ color: skin.mute }}>{c.description}</div>}
        </div>
      </div>
    );
  } else if (slug === "linkedin") {
    body = (
      <div>
        {img()}
        <div className="px-3 py-2" style={{ background: skin.panel }}>
          <div className="text-sm font-semibold line-clamp-2">{title}</div>
          <div className="text-xs truncate" style={{ color: skin.mute }}>{c.domain}</div>
        </div>
      </div>
    );
  } else if (slug === "reddit") {
    body = (
      <div className="flex items-center gap-3 p-2" style={{ border: `1px solid ${skin.line}`, borderRadius: 12 }}>
        <div className="min-w-0 flex-1 text-xs" style={{ color: skin.link }}>{c.domain}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.image && <img src={c.image} alt="" referrerPolicy="no-referrer" className="w-24 h-16 object-cover rounded-lg shrink-0" />}
      </div>
    );
  } else {
    // Threads, Bluesky and any other feed: a rounded card, picture over title and address.
    body = (
      <div style={{ border: `1px solid ${skin.line}`, borderRadius: 12, overflow: "hidden" }}>
        {img()}
        <div className="px-3 py-2">
          {slug === "threads" && <div className="text-xs truncate" style={{ color: skin.mute }}>{c.domain}</div>}
          <div className="text-sm font-semibold line-clamp-2">{title}</div>
          {slug !== "threads" && c.description && <div className="text-xs line-clamp-2" style={{ color: skin.mute }}>{c.description}</div>}
          {slug !== "threads" && (
            <div className="text-xs mt-1 pt-1 flex items-center gap-1 truncate" style={{ color: skin.mute, borderTop: `1px solid ${skin.line}` }}>
              <Globe className="w-3 h-3" /> {c.domain}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div data-preview-link-card>
      {body}
      {skin.linkCard === "maybe" && (
        <p className="text-micro mt-1" style={{ color: skin.mute }}>
          {skin.label} shows this card only when the app sending the post builds it. Zernio&apos;s documentation says it does that for LinkedIn, Facebook and Telegram but says nothing about {skin.label}, so the post may show the link as text only.
        </p>
      )}
      {card.note && <p className="text-micro mt-1" style={{ color: skin.mute }}>{card.note}</p>}
    </div>
  );
}

const Icons = ({ items, skin, className, size = 18 }: { items: Array<{ icon: typeof Heart; label?: string }>; skin: Skin; className?: string; size?: number }) => (
  <div className={`flex items-center ${className ?? ""}`} style={{ color: skin.mute }}>
    {items.map(({ icon: I, label }, i) => (
      <span key={i} className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <I style={{ width: size, height: size }} strokeWidth={1.75} />{label}
      </span>
    ))}
  </div>
);

/** A post that needs a picture or video and has none: said where the picture would be. */
const Needs = ({ skin, video }: { skin: Skin; video?: boolean }) => (
  <div className="grid place-items-center text-xs text-center px-6" style={{ aspectRatio: String(skin.aspect[1]), background: skin.panel, color: skin.mute }}>
    {skin.label} needs {video ? "a video" : "a picture or video"} — attach one and it shows here.
  </div>
);

// ── Each network ─────────────────────────────────────────────────────────────

function NetworkPost({ post, skin, avatarUrl, brandName, card }: { post: PreviewPost; skin: Skin; avatarUrl: string | null; brandName: string; card: CardState | null }) {
  const slug = post.provider.toLowerCase();
  const net = networkFor(post.provider);
  const color = net?.color ?? skin.mute;
  const name = post.accountName ?? brandName;
  const handle = post.handle ? `${skin.handle === "u/" ? "u/" : "@"}${post.handle.replace(/^@/, "")}` : null;
  const av = (size: number) => <Avatar url={avatarUrl} name={name} size={size} skin={skin} color={color} />;
  const shell: CSSProperties = { background: skin.bg, color: skin.ink, fontFamily: skin.font };
  const media = post.media;
  const needsMedia = !!net?.requiresMedia && media.length === 0;
  const linkCard = card ? <LinkCardView card={card} skin={skin} provider={post.provider} /> : null;
  const commentRow = (bubble: boolean) =>
    post.comment ? (
      <div className="flex gap-2 items-start px-3 pb-3" data-preview-comment={slug}>
        {av(28)}
        <div className={bubble ? "px-3 py-2 rounded-2xl min-w-0" : "min-w-0"} style={bubble ? { background: skin.panel } : undefined}>
          <div className="text-xs font-semibold">{name}</div>
          <Caption text={post.comment} skin={{ ...skin, fold: null, size: 13 }} />
        </div>
      </div>
    ) : null;

  // ── Full-screen vertical: TikTok, Snapchat, a Story or a Reel ──
  if (skin.layout === "vertical") {
    const story = post.subFormat === "story";
    return (
      <div className="relative overflow-hidden rounded-2xl" style={{ ...shell, aspectRatio: "9 / 16" }}>
        {media[0] ? <div className="absolute inset-0"><Shot m={media[0]} skin={skin} fill /></div> : <div className="absolute inset-0 grid place-items-center text-sm text-center px-8" style={{ color: skin.mute }}>{skin.label}{story ? " Stories" : ""} need{story ? "" : "s"} a {slug === "tiktok" || post.subFormat === "reel" ? "video" : "picture or video"}.</div>}
        {story ? (
          <div className="absolute inset-x-0 top-0 p-3" style={{ background: "linear-gradient(rgba(0,0,0,0.45), transparent)" }}>
            <div className="h-0.5 rounded-full mb-2" style={{ background: "rgba(255,255,255,0.5)" }} />
            <div className="flex items-center gap-2 text-sm font-semibold">{av(32)} {name} <span className="font-normal" style={{ color: skin.mute }}>now</span></div>
          </div>
        ) : (
          <>
            <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
              {av(44)}
              {[Heart, MessageCircle, Bookmark, Share].map((I, i) => <I key={i} className="w-8 h-8" strokeWidth={1.75} />)}
            </div>
            <div className="absolute inset-x-0 bottom-0 p-3 pr-16" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.6))" }}>
              <div className="font-semibold text-sm mb-1">{handle ?? name}</div>
              <Caption text={post.text} skin={skin} />
              {slug === "tiktok" && <div className="flex items-center gap-1.5 text-xs mt-2"><Music2 className="w-3.5 h-3.5" /> original sound - {name}</div>}
            </div>
          </>
        )}
        {story && post.text && <p className="absolute inset-x-0 bottom-0 p-3 text-micro text-center" style={{ color: skin.mute, background: "rgba(0,0,0,0.5)" }}>A Story shows no caption — the text above isn&apos;t posted with it.</p>}
      </div>
    );
  }

  // ── YouTube: the video, its title (the caption's first line) and the description ──
  if (skin.layout === "video") {
    const [title, ...rest] = post.text.split("\n");
    return (
      <div style={shell} className="rounded-xl overflow-hidden">
        {media[0] ? <Shot m={media[0]} skin={skin} aspect={16 / 9} /> : <Needs skin={skin} video />}
        <div className="p-3">
          <div className="font-semibold line-clamp-2" style={{ fontSize: 18, lineHeight: 1.3 }}>{title.slice(0, 100) || "Untitled"}</div>
          <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: skin.mute }}>
            {av(32)} <span className="font-semibold" style={{ color: skin.ink }}>{name}</span> · No views · {skin.when}
          </div>
          {rest.join("\n").trim() && (
            <div className="mt-3 p-3 rounded-xl" style={{ background: skin.panel }}>
              <Caption text={rest.join("\n").trim()} skin={skin} />
            </div>
          )}
        </div>
        {commentRow(false)}
      </div>
    );
  }

  // ── Pinterest: the pin ──
  if (skin.layout === "pin") {
    const [title, ...rest] = post.text.split("\n");
    return (
      <div style={shell} className="p-3 rounded-2xl">
        <div style={{ borderRadius: 16, overflow: "hidden" }}>{media[0] ? <Shot m={media[0]} skin={skin} /> : <Needs skin={skin} />}</div>
        <div className="font-semibold mt-2" style={{ fontSize: 16 }}>{title.slice(0, 100)}</div>
        {rest.join("\n").trim() && <Caption text={rest.join("\n").trim()} skin={skin} className="mt-1" style={{ color: skin.mute }} />}
        <div className="flex items-center gap-2 mt-2 text-xs font-semibold">{av(32)} {name}</div>
      </div>
    );
  }

  // ── Reddit: title (first line) over the body ──
  if (skin.layout === "reddit") {
    const [title, ...rest] = post.text.split("\n");
    return (
      <div style={shell} className="rounded-xl overflow-hidden p-3">
        <div className="flex items-center gap-2 text-xs" style={{ color: skin.mute }}>{av(24)} <span className="font-semibold" style={{ color: skin.ink }}>{handle ?? name}</span> · {skin.when}</div>
        <div className="font-semibold mt-2" style={{ fontSize: 18, lineHeight: 1.3 }}>{title.slice(0, 300)}</div>
        {rest.join("\n").trim() && <Caption text={rest.join("\n").trim()} skin={skin} className="mt-1" />}
        {media.length > 0 && <div className="mt-2"><MediaBlock items={media} skin={skin} radius={12} /></div>}
        {linkCard && <div className="mt-2">{linkCard}</div>}
        <div className="flex items-center gap-2 mt-3">
          {[[ArrowBigUp, "Vote", ArrowBigDown], [MessageCircle, "0"], [Share2, "Share"]].map((g, i) => {
            const [A, label, B] = g as [typeof Heart, string, typeof Heart | undefined];
            return (
              <span key={i} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: skin.panel, color: skin.ink }}>
                <A className="w-4 h-4" /> {label} {B && <B className="w-4 h-4" />}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Google Business Profile update ──
  if (skin.layout === "business") {
    const hasLink = !!firstLink(post.text);
    return (
      <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
        <div className="flex items-center gap-2 p-3">{av(40)}<div><div className="text-sm font-semibold">{name}</div><div className="text-xs" style={{ color: skin.mute }}>{skin.when}</div></div></div>
        {media[0] && <Shot m={media[0]} skin={skin} />}
        <Caption text={post.text} skin={skin} className="p-3" />
        {hasLink && <div className="px-3 pb-3"><span className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold" style={{ border: `1px solid ${skin.line}`, color: skin.link }}>Learn more</span></div>}
      </div>
    );
  }

  // ── Chat apps: Telegram, WhatsApp, Discord ──
  if (skin.layout === "chat") {
    if (slug === "discord") {
      return (
        <div style={shell} className="rounded-xl p-4 flex gap-3">
          {av(40)}
          <div className="min-w-0 flex-1">
            <div className="text-sm"><span className="font-semibold">{name}</span> <span className="text-xs" style={{ color: skin.mute }}>{skin.when}</span></div>
            <Caption text={post.text} skin={skin} />
            {media.length > 0 && <div className="mt-2 max-w-sm"><MediaBlock items={media} skin={skin} radius={8} /></div>}
            {linkCard && <div className="max-w-sm">{linkCard}</div>}
          </div>
        </div>
      );
    }
    return (
      <div style={shell} className="rounded-xl p-3">
        <div className="max-w-[88%] rounded-2xl overflow-hidden shadow-sm" style={{ background: skin.panel }}>
          {slug === "telegram" && <div className="px-3 pt-2 text-sm font-semibold" style={{ color: skin.link }}>{name}</div>}
          {media.length > 0 && <div className="pt-1"><MediaBlock items={media} skin={skin} /></div>}
          <div className="px-3 py-2">
            <Caption text={post.text} skin={skin} />
            {linkCard}
            <div className="text-right text-micro mt-1" style={{ color: skin.mute }}>{slug === "telegram" ? "1 view · " : ""}{skin.when}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Feeds: X, LinkedIn, Facebook, Instagram, Threads, Bluesky ──
  if (slug === "twitter") {
    return (
      <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
        <div className="flex gap-3 px-4 py-3">
          {av(40)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-sm min-w-0">
              <span className="font-bold truncate">{name}</span>
              <span className="truncate" style={{ color: skin.mute }}>{handle ? `${handle} · ` : ""}{skin.when}</span>
              <span className="flex-1" />
              <MoreHorizontal className="w-4 h-4 shrink-0" style={{ color: skin.mute }} />
            </div>
            <Caption text={post.text} skin={skin} />
            {media.length > 0 && <div className="mt-3"><MediaBlock items={media} skin={skin} radius={16} border /></div>}
            {linkCard && <div className="mt-3">{linkCard}</div>}
            <Icons skin={skin} className="justify-between mt-3 max-w-md" size={18} items={[{ icon: MessageCircle }, { icon: Repeat2 }, { icon: Heart }, { icon: BarChart2 }, { icon: Bookmark }, { icon: Share }]} />
          </div>
        </div>
      </div>
    );
  }

  if (slug === "instagram") {
    return (
      <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {av(32)}
          <span className="text-sm font-semibold flex-1 truncate">{post.handle ?? name}</span>
          <MoreHorizontal className="w-5 h-5" />
        </div>
        {media.length > 0 ? <MediaBlock items={media} skin={skin} /> : <Needs skin={skin} />}
        <div className="flex items-center px-3 pt-3">
          <Icons skin={{ ...skin, mute: skin.ink }} className="gap-4 flex-1" size={24} items={[{ icon: Heart }, { icon: MessageCircle }, { icon: Send }]} />
          <Icons skin={{ ...skin, mute: skin.ink }} size={24} items={[{ icon: Bookmark }]} />
        </div>
        <div className="px-3 pt-2 pb-1">
          <Caption text={post.text} skin={skin} lead={<span className="font-semibold">{post.handle ?? name} </span>} />
        </div>
        {post.comment && (
          <div className="px-3 pb-1 text-sm" data-preview-comment={slug} style={{ fontSize: 14 }}>
            <span className="font-semibold">{post.handle ?? name} </span><Rich text={post.comment} skin={skin} />
          </div>
        )}
        <div className="px-3 pb-3 text-micro uppercase" style={{ color: skin.mute }}>{skin.when}</div>
      </div>
    );
  }

  if (slug === "threads" || slug === "bluesky") {
    return (
      <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
        <div className="flex gap-3 px-4 py-3">
          {av(slug === "threads" ? 36 : 42)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <span className="font-semibold truncate">{slug === "threads" ? post.handle ?? name : name}</span>
              <span className="truncate" style={{ color: skin.mute }}>{slug === "bluesky" && handle ? `${handle} · ` : ""}{skin.when}</span>
              <span className="flex-1" />
              <MoreHorizontal className="w-4 h-4 shrink-0" style={{ color: skin.mute }} />
            </div>
            <Caption text={post.text} skin={skin} />
            {media.length > 0 && <div className="mt-2"><MediaBlock items={media} skin={skin} radius={slug === "threads" ? 8 : 10} border={slug === "bluesky"} /></div>}
            {linkCard && <div className="mt-2">{linkCard}</div>}
            <Icons skin={skin} className={slug === "threads" ? "gap-5 mt-3" : "justify-between mt-3 max-w-xs"} size={19}
              items={slug === "threads" ? [{ icon: Heart }, { icon: MessageCircle }, { icon: Repeat2 }, { icon: Send }] : [{ icon: MessageCircle }, { icon: Repeat2 }, { icon: Heart }, { icon: MoreHorizontal }]} />
          </div>
        </div>
      </div>
    );
  }

  if (slug === "linkedin") {
    return (
      <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
        <div className="flex items-start gap-2 px-3 pt-3">
          {av(48)}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{name}</div>
            <div className="text-xs flex items-center gap-1" style={{ color: skin.mute }}>{skin.when} • <Globe className="w-3 h-3" /></div>
          </div>
          <span className="text-sm font-semibold shrink-0" style={{ color: skin.link }}>+ Follow</span>
        </div>
        <Caption text={post.text} skin={skin} className="px-3 py-2" />
        {media.length > 0 && <MediaBlock items={media} skin={skin} />}
        {linkCard}
        <div className="mx-3 border-t" style={{ borderColor: skin.line }} />
        <Icons skin={skin} className="justify-around py-1.5" size={18} items={[{ icon: ThumbsUp, label: "Like" }, { icon: MessageSquare, label: "Comment" }, { icon: Repeat2, label: "Repost" }, { icon: Send, label: "Send" }]} />
        {commentRow(true)}
      </div>
    );
  }

  // Facebook, and the plain card for a network without its own entry.
  return (
    <div style={shell} className="rounded-xl overflow-hidden" data-preview-shell>
      <div className="flex items-center gap-2 px-3 pt-3">
        {av(40)}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-xs flex items-center gap-1" style={{ color: skin.mute }}>{skin.when} · <Globe className="w-3 h-3" /></div>
        </div>
        <MoreHorizontal className="w-5 h-5" style={{ color: skin.mute }} />
      </div>
      <Caption text={post.text} skin={skin} className="px-3 py-2" />
      {needsMedia ? <Needs skin={skin} /> : media.length > 0 && <MediaBlock items={media} skin={skin} />}
      {linkCard}
      <div className="mx-3 border-t" style={{ borderColor: skin.line }} />
      <Icons skin={skin} className="justify-around py-1.5" size={18} items={[{ icon: ThumbsUp, label: "Like" }, { icon: MessageCircle, label: "Comment" }, { icon: Share, label: "Share" }]} />
      {commentRow(true)}
    </div>
  );
}
