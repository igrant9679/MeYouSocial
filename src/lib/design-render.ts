/**
 * FR-18 — design-system rendering profile.
 *
 * A published article should look hand-built in the site's own design system,
 * not pasted in as flat text. The draft is always stored as clean semantic HTML;
 * this maps recognisable content patterns onto native theme components at
 * publish time, so the stored article stays portable and re-renderable when the
 * site's theme changes.
 *
 * The rule that constrains every mapping: design never overrides semantics. A
 * checklist stays a real <ul>, an FAQ stays keyboard-operable, and heading order
 * is untouched. Where a theme's own shortcode output is outside our control
 * (Fusion), that limit is stated rather than glossed over.
 */

export const RENDER_PROFILES = ["html", "gutenberg", "fusion"] as const;
export type RenderProfile = (typeof RENDER_PROFILES)[number];

export function isRenderProfile(p: string): p is RenderProfile {
  return (RENDER_PROFILES as readonly string[]).includes(p);
}

export const PROFILE_LABELS: Record<RenderProfile, string> = {
  html: "Clean semantic HTML",
  gutenberg: "Gutenberg blocks",
  fusion: "Avada / Fusion Builder",
};

export const PROFILE_NOTES: Record<RenderProfile, string> = {
  html: "Portable markup with utility classes. Works on any theme; styling is up to your stylesheet.",
  gutenberg: "Block comments so the post opens as native blocks in the WordPress editor.",
  fusion: "Fusion Builder shortcodes. Requires the Avada theme — on any other theme the shortcodes render as literal text.",
};

/** Each pattern can be turned off independently by an admin. */
export const RENDER_PATTERNS = ["checklist", "callout", "quote", "faq", "cta", "separator"] as const;
export type RenderPattern = (typeof RENDER_PATTERNS)[number];

export const PATTERN_LABELS: Record<RenderPattern, string> = {
  checklist: "Benefit / step lists → checklists",
  callout: "Tip, note and warning paragraphs → callout boxes",
  quote: "Blockquotes → styled pullquotes",
  faq: "FAQ sections → accordions",
  cta: "Call-to-action links → buttons",
  separator: "Horizontal rules → separators",
};

export type RenderRules = Record<RenderPattern, boolean>;

export const DEFAULT_RENDER_RULES: RenderRules = {
  checklist: true,
  callout: true,
  quote: true,
  faq: true,
  cta: true,
  separator: true,
};

export function parseRenderRules(json: string | null | undefined): RenderRules {
  const out = { ...DEFAULT_RENDER_RULES };
  if (!json) return out;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return out;
    for (const p of RENDER_PATTERNS) {
      const v = (raw as Record<string, unknown>)[p];
      if (typeof v === "boolean") out[p] = v;
    }
  } catch {
    // keep defaults
  }
  return out;
}

// ---- Pattern detection --------------------------------------------------------------

const CALLOUT_PREFIX = /^\s*(?:<(?:strong|b|em)>)?\s*(tip|note|important|warning|caution|remember|key takeaway)\s*[:\-—]\s*/i;

const CALLOUT_KIND: Record<string, "info" | "warning"> = {
  tip: "info",
  note: "info",
  important: "warning",
  warning: "warning",
  caution: "warning",
  remember: "info",
  "key takeaway": "info",
};

const CTA_WORDS =
  /\b(book|schedule|request|get in touch|contact us|start|try|download|subscribe|talk to|see our|compare|join)\b/i;

const FAQ_HEADING = /^\s*(?:frequently asked questions|faqs?|common questions|questions (?:and|&(?:amp;)?) answers)\s*$/i;

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * A list reads as a checklist when its items are short, declarative fragments —
 * the shape of a benefits or steps list — rather than prose paragraphs.
 */
function looksLikeChecklist(listHtml: string): boolean {
  const items = [...listHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripTags(m[1]));
  if (items.length < 2) return false;
  const longItems = items.filter((t) => t.split(/\s+/).length > 20).length;
  return longItems / items.length < 0.4;
}

// ---- Renderers ------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Renderers = {
  checklist(itemsHtml: string[], original: string): string;
  callout(kind: "info" | "warning", label: string, bodyHtml: string, original: string): string;
  quote(innerHtml: string, original: string): string;
  faq(pairs: Array<{ q: string; a: string }>, original: string): string;
  cta(href: string, text: string, original: string): string;
  separator(original: string): string;
};

const htmlRenderers: Renderers = {
  checklist: (items) =>
    `<ul class="meyou-checklist">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`,
  callout: (kind, label, body) =>
    `<aside class="meyou-callout meyou-callout--${kind}" role="note"><p><strong>${esc(label)}</strong> ${body}</p></aside>`,
  quote: (inner) => `<blockquote class="meyou-pullquote">${inner}</blockquote>`,
  faq: (pairs) =>
    `<div class="meyou-faq">${pairs
      .map((p) => `<details class="meyou-faq__item"><summary>${p.q}</summary>${p.a}</details>`)
      .join("")}</div>`,
  cta: (href, text) => `<p class="meyou-cta"><a class="meyou-button" href="${esc(href)}">${text}</a></p>`,
  separator: () => `<hr class="meyou-separator" />`,
};

const gutenbergRenderers: Renderers = {
  checklist: (items) =>
    `<!-- wp:list {"className":"is-style-checklist meyou-checklist"} -->\n<ul class="wp-block-list is-style-checklist meyou-checklist">${items
      .map((i) => `<!-- wp:list-item -->\n<li>${i}</li>\n<!-- /wp:list-item -->`)
      .join("")}</ul>\n<!-- /wp:list -->`,
  callout: (kind, label, body) =>
    `<!-- wp:group {"className":"meyou-callout meyou-callout--${kind}"} -->\n<div class="wp-block-group meyou-callout meyou-callout--${kind}" role="note"><!-- wp:paragraph -->\n<p><strong>${esc(
      label,
    )}</strong> ${body}</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->`,
  quote: (inner) =>
    `<!-- wp:pullquote -->\n<figure class="wp-block-pullquote"><blockquote>${inner}</blockquote></figure>\n<!-- /wp:pullquote -->`,
  // core/details renders a real <details>, so the accordion stays keyboard-operable.
  faq: (pairs) =>
    pairs
      .map(
        (p) =>
          `<!-- wp:details -->\n<details class="wp-block-details"><summary>${p.q}</summary><!-- wp:paragraph -->\n${p.a}\n<!-- /wp:paragraph --></details>\n<!-- /wp:details -->`,
      )
      .join("\n"),
  cta: (href, text) =>
    `<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${esc(
      href,
    )}">${text}</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->`,
  separator: () => `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`,
};

const fusionRenderers: Renderers = {
  checklist: (items) =>
    `[fusion_checklist iconcolor="" circle="yes" size="16px"]${items
      .map((i) => `[fusion_li_item icon="fa-check"]${i}[/fusion_li_item]`)
      .join("")}[/fusion_checklist]`,
  callout: (kind, label, body) =>
    `[fusion_alert type="${kind === "warning" ? "notice" : "general"}" accent_color=""]<strong>${esc(
      label,
    )}</strong> ${body}[/fusion_alert]`,
  quote: (inner) => `[fusion_blockquote]${inner}[/fusion_blockquote]`,
  faq: (pairs) =>
    `[fusion_accordion]${pairs
      .map((p) => `[fusion_toggle title="${esc(stripTags(p.q))}" open="no"]${p.a}[/fusion_toggle]`)
      .join("")}[/fusion_accordion]`,
  cta: (href, text) => `[fusion_button link="${esc(href)}" size="medium"]${stripTags(text)}[/fusion_button]`,
  separator: () => `[fusion_separator style_type="default" bottom_margin="24px"][/fusion_separator]`,
};

const RENDERERS: Record<RenderProfile, Renderers> = {
  html: htmlRenderers,
  gutenberg: gutenbergRenderers,
  fusion: fusionRenderers,
};

// ---- The transform ---------------------------------------------------------------------

export type RenderReport = Record<RenderPattern, number>;

/**
 * Map the draft's patterns onto the chosen profile. Returns the rendered HTML
 * plus a count of what was transformed, so the editor can show what publishing
 * will actually change.
 */
export function renderDesignSystem(
  html: string,
  profile: RenderProfile,
  rules: RenderRules,
): { html: string; report: RenderReport } {
  const report: RenderReport = { checklist: 0, callout: 0, quote: 0, faq: 0, cta: 0, separator: 0 };
  if (profile === "html" && !rules.checklist && !rules.callout && !rules.quote && !rules.faq && !rules.cta && !rules.separator) {
    return { html, report };
  }
  const r = RENDERERS[profile];
  let out = html;

  // FAQ first: it consumes the h3/p pairs that follow an FAQ heading, and the
  // later passes must not have already rewritten them.
  if (rules.faq) {
    out = out.replace(
      /<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi,
      (full, headingInner: string, section: string) => {
        if (!FAQ_HEADING.test(stripTags(headingInner))) return full;
        const pairs = [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>\s*((?:<p\b[\s\S]*?<\/p>\s*)+)/gi)].map((m) => ({
          q: m[1].trim(),
          a: m[2].trim(),
        }));
        if (pairs.length < 2) return full;
        report.faq += pairs.length;
        const heading = full.slice(0, full.indexOf("</h2>") + 5);
        return `${heading}\n${r.faq(pairs, section)}\n`;
      },
    );
  }

  if (rules.checklist) {
    out = out.replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, (list) => {
      if (!looksLikeChecklist(list)) return list;
      const items = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1].trim());
      if (!items.length) return list;
      report.checklist++;
      return r.checklist(items, list);
    });
  }

  if (rules.callout) {
    out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (para, inner: string) => {
      const m = inner.match(CALLOUT_PREFIX);
      if (!m) return para;
      const word = m[1].toLowerCase();
      const kind = CALLOUT_KIND[word] ?? "info";
      const label = m[1].replace(/\b\w/g, (c) => c.toUpperCase()) + ":";
      const body = inner.slice(m[0].length).replace(/<\/(?:strong|b|em)>/i, "").trim();
      report.callout++;
      return r.callout(kind, label, body, para);
    });
  }

  if (rules.quote) {
    out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (bq, inner: string) => {
      report.quote++;
      return r.quote(inner.trim(), bq);
    });
  }

  if (rules.cta) {
    out = out.replace(/<p\b[^>]*>\s*(<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>)\s*<\/p>/gi, (para, _a, href: string, text: string) => {
      // Only a paragraph that is nothing but one action link.
      if (!CTA_WORDS.test(stripTags(text))) return para;
      report.cta++;
      return r.cta(href, text.trim(), para);
    });
  }

  if (rules.separator) {
    out = out.replace(/<hr\s*\/?>/gi, () => {
      report.separator++;
      return r.separator("<hr>");
    });
  }

  return { html: out, report };
}

export function reportSummary(report: RenderReport): string {
  const parts = RENDER_PATTERNS.filter((p) => report[p] > 0).map((p) => `${report[p]} ${p}${report[p] > 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "nothing matched — the article publishes as written";
}
