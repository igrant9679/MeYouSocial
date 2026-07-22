// Structured data (Wave B′): Article JSON-LD, plus FAQPage when the body has a
// FAQ section (h2 containing "frequently asked" followed by h3 question / p
// answer pairs). Embedded into the WordPress payload at publish.

type PostLike = {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  body: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
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

export function buildJsonLd(post: PostLike, orgName: string): string {
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      headline: post.metaTitle ?? post.title,
      description: post.metaDescription ?? undefined,
      datePublished: (post.publishedAt ?? post.createdAt).toISOString(),
      url: post.publishedUrl ?? undefined,
      publisher: { "@type": "Organization", name: orgName },
      author: { "@type": "Organization", name: orgName },
    },
  ];
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
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}
