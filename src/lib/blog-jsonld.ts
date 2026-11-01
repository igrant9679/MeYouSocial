// Structured data (Wave B′, completed by E-ART-14): Article JSON-LD — with its
// image, dateModified and the expert who speaks in it as the author — a
// BreadcrumbList once the article has a public URL, plus FAQPage when the body
// has a FAQ section (h2 containing "frequently asked" followed by h3 question /
// p answer pairs). Embedded into the WordPress payload at publish and into the
// HTML export.

type PostLike = {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  body: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt?: Date | null;
};

/** What only the caller knows: a public image, the expert, the site's home. */
export type JsonLdExtras = {
  /** A URL a crawler can fetch — never the app's session-gated storage. */
  imageUrl?: string | null;
  expert?: { name: string; role?: string | null; credentials?: string | null } | null;
  /** The site's home page, for the breadcrumb (defaults to the article URL's origin). */
  siteUrl?: string | null;
};

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function extractFaq(body: string): Array<{ q: string; a: string }> {
  const faqIdx = body.search(/<h2[^>]*>[^<]*frequently asked[^<]*<\/h2>/i);
  if (faqIdx < 0) return [];
  const tail = body.slice(faqIdx);
  const pairs: Array<{ q: string; a: string }> = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*((?:<p[^>]*>[\s\S]*?<\/p>\s*)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) && pairs.length < 10) {
    const q = strip(m[1]);
    const a = strip(m[2]);
    if (q && a) pairs.push({ q, a: a.slice(0, 600) });
  }
  return pairs;
}

const publicUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function buildJsonLd(post: PostLike, orgName: string, extras: JsonLdExtras = {}): string {
  const org = { "@type": "Organization", name: orgName };
  const image = publicUrl(extras.imageUrl);
  const url = publicUrl(post.publishedUrl);
  const published = post.publishedAt ?? post.createdAt;
  const author = extras.expert?.name
    ? {
        "@type": "Person",
        name: extras.expert.name,
        ...(extras.expert.role ? { jobTitle: extras.expert.role } : {}),
        ...(extras.expert.credentials ? { description: extras.expert.credentials.slice(0, 300) } : {}),
        worksFor: org,
      }
    : org;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      headline: (post.metaTitle ?? post.title).slice(0, 110),
      description: post.metaDescription ?? undefined,
      ...(image ? { image: [image] } : {}),
      datePublished: published.toISOString(),
      // Never earlier than it went live.
      dateModified: (post.updatedAt && post.updatedAt > published ? post.updatedAt : published).toISOString(),
      url,
      ...(url ? { mainEntityOfPage: { "@type": "WebPage", "@id": url } } : {}),
      publisher: org,
      author,
    },
  ];
  if (url) {
    const home = publicUrl(extras.siteUrl) ?? new URL(url).origin;
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: orgName, item: home },
        { "@type": "ListItem", position: 2, name: post.title, item: url },
      ],
    });
  }
  const faq = post.body ? extractFaq(post.body) : [];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  // Inside a <script>: a "<" in a title must not be able to close it.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}
