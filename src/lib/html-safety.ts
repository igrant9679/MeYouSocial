/**
 * Remove what can EXECUTE from stored HTML, and nothing else.
 *
 * The article body is rendered back into the editor with dangerouslySetInnerHTML
 * and shipped to WordPress and the HTML export, so an `<img onerror=…>` saved by
 * an Editor ran as the Admin (or platform operator) who opened the article.
 * The body deliberately skips `sanitizeRichHtml`'s allowlist — a drafting model
 * or a WordPress import legitimately produces sections, ids, classes and inline
 * styles, and silently deleting them on autosave would damage articles. So this
 * is a denylist of executable constructs, applied by re-serialising EVERY tag
 * through a small tokenizer:
 *
 * - script-bearing elements go with their content (script, style, template,
 *   object, embed, applet, frameset, noscript, SVG animation that can rewrite an
 *   href), form controls and document-level elements (base, meta, link) go;
 * - iframes survive only for known video embed hosts;
 * - `on*` handlers, `srcdoc`, `formaction` and script URLs (javascript:,
 *   vbscript:, data: — except data:image in src) are dropped, after decoding
 *   entities the way the browser will (`&#106;avascript:` is still javascript);
 * - inline styles survive unless they carry expression()/behavior/-moz-binding
 *   or a script URL;
 * - a tag the browser would parse differently than a regex does (`<img/src=x
 *   onerror=…>`, `>` inside quotes) is read with the browser's own rules, so
 *   what is checked is what would run.
 *
 * Pure string work with no DOM, so it runs identically on the server and in the
 * browser (the editor seeds from it without a hydration mismatch).
 */

const DROP_WITH_CONTENT = new Set([
  "script", "style", "template", "object", "embed", "applet", "frameset", "frame",
  "noscript", "noembed", "noframes", "xml", "title", "textarea", "select",
]);
const DROP_TAG = new Set([
  "base", "meta", "link", "form", "input", "button", "option", "optgroup", "datalist",
  "keygen", "output", "param", "set", "animate", "animatemotion", "animatetransform", "isindex",
]);
const URL_ATTRS = new Set([
  "href", "src", "xlink:href", "action", "background", "poster", "data", "lowsrc",
  "dynsrc", "longdesc", "cite", "ping", "srcset", "codebase", "manifest", "icon",
]);
const IFRAME_HOSTS = [
  "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com",
  "www.loom.com", "fast.wistia.net", "open.spotify.com",
];
const NAME_OK = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

const NAMED: Record<string, string> = {
  colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", bsol: "\\",
  quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " ", semi: ";", comma: ",", period: ".",
};

/** Decode entities the way an attribute value is decoded before the browser uses it. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** The scheme a URL attribute would actually navigate to or load. */
function scheme(raw: string): string {
  // Control characters and whitespace are ignored by URL parsing, so
  // "java\tscript:" and " javascript:" are both javascript.
  const cleaned = [...decodeEntities(raw)]
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return !(c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff);
    })
    .join("");
  return cleaned.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? "";
}

function urlAllowed(attr: string, raw: string, tag: string): boolean {
  if (attr === "srcset") return raw.split(",").every((part) => urlAllowed("src", part.trim().split(/\s+/)[0] ?? "", tag));
  const s = scheme(raw);
  if (!s) return true; // relative, fragment, or path
  if (s === "javascript" || s === "vbscript" || s === "livescript" || s === "mocha") return false;
  if (s === "data") {
    // Embedded images are how the HTML export ships pictures; nothing else.
    return (attr === "src" || attr === "srcset") && (tag === "img" || tag === "source") && /^data:image\//i.test(decodeEntities(raw).trim());
  }
  return true;
}

function styleAllowed(raw: string): boolean {
  const v = decodeEntities(raw).replace(/\\/g, "").replace(/\s+/g, " ").toLowerCase();
  return !/(expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import)/.test(v);
}

function iframeAllowed(attrs: Array<[string, string | null]>): boolean {
  const src = attrs.find(([n]) => n === "src")?.[1];
  if (!src) return false;
  try {
    const u = new URL(decodeEntities(src).trim(), "https://invalid.example");
    return u.protocol === "https:" && IFRAME_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const escapeAttr = (v: string) => v.replace(/"/g, "&quot;");

/**
 * Index just past `</name …>` (case-insensitive) from `from`, or the end of the
 * string. script/style are raw text to the browser, so the first matching close
 * tag is exactly where the browser ends them.
 */
function endOfElement(s: string, from: number, name: string): number {
  let pos = from;
  for (;;) {
    const at = s.indexOf("</", pos);
    if (at === -1) return s.length;
    if (s.slice(at + 2, at + 2 + name.length).toLowerCase() === name) {
      let k = at + 2 + name.length;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] === ">") return k + 1;
    }
    pos = at + 2;
  }
}

/** Parse a start tag's attributes from `i` (just past the tag name), browser rules. */
function readTag(s: string, i: number): { attrs: Array<[string, string | null]>; end: number; selfClosing: boolean } | null {
  const attrs: Array<[string, string | null]> = [];
  let selfClosing = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ">") return { attrs, end: i + 1, selfClosing };
    if (c === "/" ) { selfClosing = s[i + 1] === ">"; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    // attribute name: everything up to whitespace, /, >, or =
    let j = i;
    while (j < n && !/[\s/>=]/.test(s[j])) j++;
    const name = s.slice(i, j).toLowerCase();
    i = j;
    while (i < n && /\s/.test(s[i])) i++;
    let value: string | null = null;
    if (s[i] === "=") {
      i++;
      while (i < n && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        if (close === -1) return null; // unterminated — the browser would swallow the rest
        value = s.slice(i + 1, close);
        i = close + 1;
      } else {
        let k = i;
        while (k < n && !/[\s>]/.test(s[k])) k++;
        value = s.slice(i, k);
        i = k;
      }
    }
    if (name) attrs.push([name, value]);
  }
  return null; // no closing '>' — not a tag the browser would finish either
}

export function stripExecutableHtml(input: string | null | undefined): string {
  const s = input ?? "";
  if (!s.includes("<")) return s;
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    i = lt;

    // Comments are inert (WordPress block markup lives in them) — keep whole ones.
    if (s.startsWith("<!--", i)) {
      const close = s.indexOf("-->", i + 4);
      if (close === -1) { out += "&lt;"; i += 1; continue; }
      const body = s.slice(i + 4, close);
      // ⚠ Browsers also end a comment at "--!>", and treat "<!-->" / "<!--->"
      // as complete comments — markup after those would RUN while this
      // tokenizer thought it was inside a comment. Keep only comments the
      // browser closes exactly where we do; drop the rest whole.
      const unambiguous = !body.startsWith(">") && !body.startsWith("->") && !body.includes("--!>") && !body.includes("<!--");
      if (unambiguous) out += s.slice(i, close + 3);
      i = close + 3;
      continue;
    }
    // Doctype, CDATA, processing instructions: dropped.
    if (s[i + 1] === "!" || s[i + 1] === "?") {
      const close = s.indexOf(">", i);
      i = close === -1 ? n : close + 1;
      continue;
    }

    const closing = s[i + 1] === "/";
    const nameStart = i + (closing ? 2 : 1);
    // Our own (narrower) name rule is safe: whatever follows is re-read as
    // attributes and only allow-shaped names survive serialisation.
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:._-]*/.exec(s.slice(nameStart, nameStart + 64));
    if (!nameMatch) { out += "&lt;"; i += 1; continue; }
    const rawName = nameMatch[0].toLowerCase();
    const tag = rawName.includes(":") ? rawName.slice(rawName.indexOf(":") + 1) : rawName;
    const parsed = readTag(s, nameStart + nameMatch[0].length);
    if (!parsed) { out += "&lt;"; i += 1; continue; }

    if (closing) {
      i = parsed.end;
      if (DROP_WITH_CONTENT.has(tag) || DROP_TAG.has(tag)) continue;
      // (A disallowed iframe was skipped with its content, so a closing tag
      // reaching here belongs to an allowed one — or is a harmless stray.)
      out += `</${rawName}>`;
      continue;
    }

    const dropWithContent = DROP_WITH_CONTENT.has(tag) || (tag === "iframe" && !iframeAllowed(parsed.attrs));
    if (dropWithContent) {
      // Skip to the matching close tag (script/style are raw text to the
      // browser, so the first close tag IS where the browser ends them).
      i = endOfElement(s, parsed.end, rawName);
      continue;
    }
    if (DROP_TAG.has(tag)) { i = parsed.end; continue; }

    const kept: string[] = [];
    for (const [name, value] of parsed.attrs) {
      if (!NAME_OK.test(name)) continue;
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") continue;
      if (value !== null && (URL_ATTRS.has(name) || name.endsWith(":href")) && !urlAllowed(name, value, tag)) continue;
      if (name === "style" && value !== null && !styleAllowed(value)) continue;
      if (name === "http-equiv") continue;
      kept.push(value === null ? name : `${name}="${escapeAttr(value)}"`);
    }
    out += `<${rawName}${kept.length ? " " + kept.join(" ") : ""}${parsed.selfClosing ? " /" : ""}>`;
    i = parsed.end;
  }
  return out;
}
