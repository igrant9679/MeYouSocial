import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { applyInternalLinkAction, suggestInternalLinksAction } from "@/app/actions/blog-optimize";
import { linkFromArticleAction } from "@/app/actions/link-inventory";
import { hrefs, inboundOffers, loadInventory, normalizeUrl, outboundOffers } from "@/lib/link-inventory";

/**
 * One article's place in the site's internal links (E-ART-12): who links here,
 * what it links to, the articles that mention its focus keyword and could link
 * here, the pages whose keyword it mentions and could link to — matched as
 * whole words outside existing links, nothing guessed — and the AI's own
 * suggestions from the page inventory.
 */
export async function InternalLinks({
  workspaceId, post, editor, aiSuggestions,
}: {
  workspaceId: string;
  post: { id: string; publishedUrl: string | null; focusKeyword: string | null; body: string | null };
  editor: boolean;
  aiSuggestions: Array<{ url: string; anchorText: string }>;
}) {
  const { inv, articles } = await loadInventory(workspaceId);
  const self = post.publishedUrl ? normalizeUrl(post.publishedUrl) : null;
  const node = self ? inv.nodes.get(self) : undefined;
  const linkedFrom = (node?.inbound ?? []).map((u) => inv.nodes.get(u)).filter((n): n is NonNullable<typeof n> => !!n);
  const linksTo = [...new Set(hrefs(post.body ?? "").map((h) => normalizeUrl(h, post.publishedUrl ?? undefined)).filter((u): u is string => !!u && u !== self && inv.nodes.has(u)))];
  // Live = in the inventory: published, or back in review for a refresh at the same URL.
  const live = !!node;
  const offersIn = live ? inboundOffers(inv, articles, post.id) : [];
  const offersOut = outboundOffers(inv, post.body, post.publishedUrl);
  const orphans = inv.orphans.length;

  return (
    <section className="card mt-4" id="internal-links" data-internal-links>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h2 className="text-sm font-semibold flex-1">Internal links</h2>
        {editor && post.body && (
          <form action={suggestInternalLinksAction}>
            <input type="hidden" name="id" value={post.id} />
            <SubmitButton className="btn sm" pendingText="Matching…">Ask the AI for more</SubmitButton>
          </form>
        )}
      </div>
      <p className="text-xs text-[var(--mute)] mt-0 mb-3" data-link-summary>
        {live ? <>{linkedFrom.length === 1 ? "1 page links" : `${linkedFrom.length} pages link`} here · </> : null}
        this links to {linksTo.length} of the {inv.nodes.size} page{inv.nodes.size === 1 ? "" : "s"} the site is known to have.
        {!live && " Once it's published at a link, the articles that could link here are listed too."}
      </p>

      {linkedFrom.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold mb-1">Linked from</p>
          <ul className="m-0 p-0 list-none flex flex-col gap-0.5 text-xs">
            {linkedFrom.slice(0, 8).map((n) => (
              <li key={n.url} className="truncate">{n.articleId ? <Link href={`/blog/${n.articleId}`} className="hover:underline">{n.title}</Link> : <a href={n.href} className="hover:underline" target="_blank" rel="noreferrer">{n.title}</a>}</li>
            ))}
            {linkedFrom.length > 8 && <li className="text-[var(--mute)]">and {linkedFrom.length - 8} more</li>}
          </ul>
        </div>
      )}

      {live && !post.focusKeyword && (
        <p className="text-xs text-[var(--mute)] mb-3">Give this article a focus keyword and the articles that mention it are offered here as places to link from.</p>
      )}
      {offersIn.length > 0 && (
        <div className="mb-3" data-offers-in>
          <p className="text-[11px] font-semibold mb-1">Could link here — they mention &ldquo;{post.focusKeyword}&rdquo;</p>
          <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs">
            {offersIn.map((o) => (
              <li key={o.articleId} className="flex items-center gap-2 flex-wrap" data-offer-in={o.articleId}>
                <Link href={`/blog/${o.articleId}`} className="font-semibold hover:underline min-w-0 truncate">{o.title}</Link>
                <span className="text-[var(--mute)]">&ldquo;{o.phrase}&rdquo;</span>
                <span className="flex-1" />
                {editor && (
                  <form action={linkFromArticleAction}>
                    <input type="hidden" name="targetId" value={post.id} />
                    <input type="hidden" name="fromId" value={o.articleId} />
                    <SubmitButton className="btn sm" pendingText="Linking…" title="Link that mention here; that article goes back through review">Link from there</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {offersOut.length > 0 && (
        <div className="mb-3" data-offers-out>
          <p className="text-[11px] font-semibold mb-1">Could link to — this mentions their keyword</p>
          <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs">
            {offersOut.map((o) => (
              <li key={o.href} className="flex items-center gap-2 flex-wrap" data-offer-out={o.articleId ?? o.href}>
                <span>&ldquo;{o.phrase}&rdquo; →</span>
                {o.articleId ? <Link href={`/blog/${o.articleId}`} className="font-semibold hover:underline min-w-0 truncate">{o.title}</Link> : <span className="font-semibold min-w-0 truncate">{o.title}</span>}
                <span className="flex-1" />
                {editor && (
                  <form action={applyInternalLinkAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <input type="hidden" name="url" value={o.href} />
                    <input type="hidden" name="anchorText" value={o.phrase} />
                    <SubmitButton className="btn sm" pendingText="Linking…" title="Link the first free mention">Link it</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {aiSuggestions.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold mb-1">The AI&apos;s suggestions</p>
          <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs">
            {aiSuggestions.map((l) => (
              <li key={l.url} className="flex items-center gap-2 flex-wrap">
                <span>&ldquo;{l.anchorText}&rdquo; → <span className="font-mono text-[10px] break-all">{l.url}</span></span>
                <span className="flex-1" />
                {editor && (
                  <form action={applyInternalLinkAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <input type="hidden" name="url" value={l.url} />
                    <input type="hidden" name="anchorText" value={l.anchorText} />
                    <SubmitButton className="btn sm" pendingText="Linking…" title="Link the first free occurrence of the anchor text">Link it</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {offersIn.length === 0 && offersOut.length === 0 && aiSuggestions.length === 0 && (
        <p className="text-xs text-[var(--mute)] mb-2" data-no-offers>No mention of another page&apos;s keyword{live && post.focusKeyword ? `, and no other article mentions “${post.focusKeyword}”` : ""} outside an existing link.</p>
      )}
      <p className="text-[10px] text-[var(--mute)] m-0">
        Mentions are matched on focus keywords (and recorded pages&apos; topics) as whole words outside existing links.{" "}
        <Link href="/website#internal-links" className="underline">{orphans} page{orphans === 1 ? "" : "s"} on the site nobody links to →</Link>
      </p>
    </section>
  );
}
