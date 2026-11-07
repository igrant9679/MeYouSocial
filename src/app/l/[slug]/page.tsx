import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bioLinks, workspaceForSlug } from "@/lib/link-in-bio";
import { formatShortDay } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";

// A workspace's public link-in-bio page (E-SOC-11): the links in its recently
// sent posts, newest first, one per destination, each tagged
// utm_source=linkinbio. No sign-in; nothing on it that wasn't already posted.
// 404 when the page is off or the address belongs to no one.

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ws = await workspaceForSlug((await params).slug);
  return ws ? { title: `${ws.name} — links`, robots: { index: false } } : { title: "Not found" };
}

export default async function LinkInBioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await workspaceForSlug(slug);
  if (!ws) notFound();
  const [links, tz] = await Promise.all([bioLinks(ws.id), getPostingTimeZone(ws.id).catch(() => "UTC")]);

  return (
    <main className="min-h-screen p-4 sm:p-8" data-link-in-bio>
      {/* A plain centred column — a centring grid shrank the cards to their text on a phone. */}
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-5">
          <span className="w-14 h-14 rounded-2xl text-white inline-grid place-items-center font-mono font-bold text-xl mb-2" style={{ background: "var(--accent)" }}>{ws.name.slice(0, 2).toUpperCase()}</span>
          <h1 className="font-mono font-bold text-xl leading-tight m-0">{ws.name}</h1>
          <p className="text-xs text-[var(--mute)] m-0">What we&apos;ve shared lately</p>
        </div>
        {links.length === 0 ? (
          <p className="card text-sm text-center text-[var(--mute)]" data-bio-empty>Nothing shared with a link yet.</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} rel="noopener" className="card !mb-0 block hover:border-[var(--accent)] transition-colors" data-bio-link>
                  <span className="block text-sm font-semibold leading-snug">{l.title}</span>
                  <span className="block font-mono text-micro text-[var(--mute)] mt-0.5">{l.host} · {formatShortDay(l.at, tz)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
