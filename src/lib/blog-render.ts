import { HEADING_LEVELS, type HeadingLevel, type HeadingStyle } from "@/lib/motifs";

/**
 * FR-2 + FR-11 — render the stored HTML the way the workspace wants it to look
 * on the connected site.
 *
 * Heading sizes go on as *inline* styles. A `<style>` block would be stripped
 * by many editors and would still lose to a theme's own selectors; inline
 * declarations beat theme CSS without touching the semantic H order, which is
 * exactly the split FR-2 asks for (article-scoped visual sizes, untouched
 * hierarchy). Any inline style the author already wrote is kept and wins, since
 * it lands after ours in the same attribute.
 */

function declarations(s: HeadingStyle): string {
  const parts = [
    `font-size:${s.px}px`,
    `margin-top:${s.marginTop}px`,
    `margin-bottom:${s.marginBottom}px`,
  ];
  if (s.weight) parts.push(`font-weight:${s.weight}`);
  if (s.lineHeight) parts.push(`line-height:${s.lineHeight}`);
  if (s.color) parts.push(`color:${s.color}`);
  return parts.join(";");
}

function mergeStyleAttr(existingAttrs: string, ours: string): string {
  const styleMatch = existingAttrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!styleMatch) return `${existingAttrs} style="${ours}"`;
  const existing = (styleMatch[2] ?? styleMatch[3] ?? "").trim().replace(/;+$/, "");
  // Ours first so the author's own declarations still override them.
  const merged = existing ? `${ours};${existing}` : ours;
  return existingAttrs.replace(styleMatch[0], ` style="${merged}"`);
}

/** Apply the workspace heading spec to every h1–h6 in the body. */
export function applyHeadingSpec(html: string, spec: Record<HeadingLevel, HeadingStyle>): string {
  let out = html;
  for (const level of HEADING_LEVELS) {
    const decls = declarations(spec[level]);
    const re = new RegExp(`<${level}(\\s[^>]*)?>`, "gi");
    out = out.replace(re, (_full, attrs: string | undefined) => {
      const merged = mergeStyleAttr(attrs ?? "", decls);
      return `<${level}${merged}>`;
    });
  }
  return out;
}

/** Append the workspace's footer credit, if it has one. */
export function appendFooterCredit(html: string, credit: string | null | undefined): string {
  const text = credit?.trim();
  if (!text) return html;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${html}\n<p class="meyou-footer-credit" style="margin-top:32px;font-size:13px;opacity:0.75">${escaped}</p>`;
}

/**
 * The full publish-time transform: heading spec, footer credit, then whatever
 * structured data the caller appends. Kept separate from the stored body so the
 * editor keeps showing clean HTML.
 */
export function renderForPublish(
  body: string,
  opts: { headingSpec: Record<HeadingLevel, HeadingStyle>; footerCredit?: string | null },
): string {
  return appendFooterCredit(applyHeadingSpec(body, opts.headingSpec), opts.footerCredit);
}
