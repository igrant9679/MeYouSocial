// WordPress REST adapter (ported from Spark's lib/wordpress.ts). Application
// passwords over Basic auth. Beyond post creation this now covers the FR-11
// publish surface: media upload for the featured image, category/tag
// resolve-or-create, author lookup, draft handoff, and a read-back of the
// created post so we can report what WordPress actually stored.

export type WpCredentials = { baseUrl: string; username: string; appPassword: string };

function authHeader(c: WpCredentials): string {
  return "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
}

function api(c: WpCredentials, path: string): string {
  return c.baseUrl.replace(/\/+$/, "") + "/wp-json/wp/v2" + path;
}

/** Verify credentials by fetching the authenticated user. */
export async function wpTestConnection(c: WpCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(api(c, "/users/me"), {
      headers: { Authorization: authHeader(c) },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from /users/me` };
    const me = (await res.json()) as { name?: string };
    return { ok: true, detail: `Authenticated as ${me.name ?? c.username}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "connection failed" };
  }
}

export type WpPublishInput = {
  title: string;
  slug?: string | null;
  content: string;
  excerpt?: string | null; // meta description
  status: "draft" | "publish";
  /** Plugin-specific SEO meta. WordPress silently drops keys that aren't
   *  registered with show_in_rest — hence the read-back. */
  meta?: Record<string, string>;
  categories?: number[];
  tags?: number[];
  author?: number;
  featuredMedia?: number;
  /** Theme post-template file (e.g. "template-fullwidth.php"). WP silently
   *  falls back to the default template when the file doesn't exist in the
   *  active theme — the read-back report is what tells the truth. */
  template?: string;
};

/** Create the post. Returns the WP post id + public link. */
export async function wpCreatePost(
  c: WpCredentials,
  input: WpPublishInput,
): Promise<{ id: number; link: string }> {
  const res = await fetch(api(c, "/posts"), {
    method: "POST",
    headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      slug: input.slug ?? undefined,
      content: input.content,
      excerpt: input.excerpt ?? undefined,
      status: input.status,
      meta: input.meta && Object.keys(input.meta).length ? input.meta : undefined,
      categories: input.categories?.length ? input.categories : undefined,
      tags: input.tags?.length ? input.tags : undefined,
      author: input.author ?? undefined,
      featured_media: input.featuredMedia ?? undefined,
      template: input.template || undefined,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WordPress rejected the post (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const post = (await res.json()) as { id: number; link: string };
  return { id: post.id, link: post.link };
}

/**
 * Update only a post's `meta` (SEO plugin fields). The failure DETAIL matters
 * here more than most places: WordPress answers 400 `rest_invalid_param` when
 * the meta object carries keys no plugin registered — which is exactly how
 * "Yoast isn't installed on the site" presents. Swallowing that into a bare
 * false made the two very different fixes (install the plugin vs unblock the
 * firewall) indistinguishable.
 */
export async function wpUpdatePostMeta(
  c: WpCredentials,
  id: number,
  meta: Record<string, string>,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(api(c, `/posts/${id}`), {
      method: "POST",
      headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify({ meta }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body.message) detail = `HTTP ${res.status} ${body.code ?? ""}: ${body.message}`.slice(0, 200);
    } catch { /* keep the status line */ }
    return { ok: false, detail };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "network failure" };
  }
}

/** Read a created post back with edit context so `meta` is exposed. */
export async function wpReadPost(
  c: WpCredentials,
  id: number,
): Promise<{ meta: Record<string, unknown> | null; featuredMedia: number | null; categories: number[]; tags: number[] } | null> {
  try {
    const res = await fetch(api(c, `/posts/${id}?context=edit`), {
      headers: { Authorization: authHeader(c) },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const post = (await res.json()) as {
      meta?: Record<string, unknown>;
      featured_media?: number;
      categories?: number[];
      tags?: number[];
    };
    return {
      meta: post.meta ?? null,
      featuredMedia: post.featured_media ?? null,
      categories: post.categories ?? [],
      tags: post.tags ?? [],
    };
  } catch {
    return null;
  }
}

// ---- Crawl (FR-15) -----------------------------------------------------------------

export type WpExistingPost = {
  id: number;
  link: string;
  title: string;
  content: string;
  modified: string | null;
};

/**
 * Page through the site's published posts. Read-only: the audit never writes,
 * so a crawl can be run against a live site without risk.
 */
export async function wpListPosts(c: WpCredentials, maxPosts = 200): Promise<WpExistingPost[]> {
  const out: WpExistingPost[] = [];
  const perPage = 50;
  for (let page = 1; out.length < maxPosts && page <= 20; page++) {
    let res: Response;
    try {
      res = await fetch(
        api(c, `/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,link,title,content,modified`),
        { headers: { Authorization: authHeader(c) }, signal: AbortSignal.timeout(30000) },
      );
    } catch {
      break;
    }
    if (!res.ok) break;
    const batch = (await res.json().catch(() => [])) as Array<{
      id: number;
      link: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
      modified?: string;
    }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const p of batch) {
      out.push({
        id: p.id,
        link: p.link,
        title: (p.title?.rendered ?? "").replace(/<[^>]+>/g, "").trim() || p.link,
        content: p.content?.rendered ?? "",
        modified: p.modified ?? null,
      });
    }
    if (batch.length < perPage) break;
  }
  return out.slice(0, maxPosts);
}

// ---- Taxonomy --------------------------------------------------------------------

type Taxonomy = "categories" | "tags";

/**
 * Resolve names to term ids, creating any that don't exist. A name that can
 * neither be found nor created is skipped rather than failing the publish —
 * the publish report records what landed.
 */
export async function wpResolveTerms(
  c: WpCredentials,
  taxonomy: Taxonomy,
  names: string[],
): Promise<{ ids: number[]; missed: string[] }> {
  const ids: number[] = [];
  const missed: string[] = [];
  for (const name of names.slice(0, 20)) {
    const clean = name.trim();
    if (!clean) continue;
    try {
      const searchRes = await fetch(api(c, `/${taxonomy}?search=${encodeURIComponent(clean)}&per_page=20`), {
        headers: { Authorization: authHeader(c) },
        signal: AbortSignal.timeout(15000),
      });
      if (searchRes.ok) {
        const found = (await searchRes.json()) as Array<{ id: number; name: string }>;
        const exact = found.find((t) => t.name.toLowerCase() === clean.toLowerCase());
        if (exact) {
          ids.push(exact.id);
          continue;
        }
      }
      const createRes = await fetch(api(c, `/${taxonomy}`), {
        method: "POST",
        headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean }),
        signal: AbortSignal.timeout(15000),
      });
      if (createRes.ok) {
        const created = (await createRes.json()) as { id: number };
        ids.push(created.id);
      } else if (createRes.status === 400) {
        // "term_exists" carries the existing id in the error payload.
        const body = (await createRes.json().catch(() => null)) as { data?: { term_id?: number } } | null;
        if (body?.data?.term_id) ids.push(body.data.term_id);
        else missed.push(clean);
      } else {
        missed.push(clean);
      }
    } catch {
      missed.push(clean);
    }
  }
  return { ids, missed };
}

/** Look up an author id from a username, slug, or numeric id. */
export async function wpResolveAuthor(c: WpCredentials, who: string): Promise<number | null> {
  const trimmed = who.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  try {
    const res = await fetch(api(c, `/users?search=${encodeURIComponent(trimmed)}&per_page=20`), {
      headers: { Authorization: authHeader(c) },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const users = (await res.json()) as Array<{ id: number; slug?: string; name?: string; username?: string }>;
    const hit =
      users.find((u) => u.slug?.toLowerCase() === trimmed.toLowerCase()) ??
      users.find((u) => u.username?.toLowerCase() === trimmed.toLowerCase()) ??
      users.find((u) => u.name?.toLowerCase() === trimmed.toLowerCase()) ??
      users[0];
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

// ---- Media ------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

function filenameFor(url: string): { name: string; mime: string } {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const base = (path.split("/").pop() || "featured").split("?")[0].slice(0, 80);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "jpg";
  const mime = MIME_BY_EXT[ext] ?? "image/jpeg";
  const name = base.includes(".") ? base : `${base}.jpg`;
  return { name, mime };
}

/**
 * Mirror an image into the WordPress media library and return its id, so the
 * post can carry a real featured image rather than a hotlink.
 */
export async function wpUploadMedia(
  c: WpCredentials,
  imageUrl: string,
  altText: string | null,
): Promise<{ id: number; sourceUrl: string } | null> {
  // ⚠ Only for EXTERNAL http(s) urls. Our own stored images live at
  // session-gated RELATIVE urls (/api/files/…) that a server-side fetch cannot
  // read — Node rejects the relative URL outright, this returned null, and the
  // first real publish (2026-08-12) went out with no featured image while the
  // report quietly said featuredUploadFailed. publishCore now resolves stored
  // keys to bytes itself and calls wpUploadMediaBytes below.
  try {
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    const src = await fetch(imageUrl, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!src.ok) return null;
    const buf = await src.arrayBuffer();
    if (!buf.byteLength) return null;
    const { name, mime } = filenameFor(imageUrl);
    const contentType = src.headers.get("content-type")?.split(";")[0] || mime;
    return await wpUploadMediaBytes(c, new Uint8Array(buf), name, contentType, altText);
  } catch {
    return null;
  }
}

/** Image mime from magic bytes — for stored files whose keys carry no extension. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 2 && b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  return null;
}

/** Upload raw image bytes into the WP media library and set alt text. */
export async function wpUploadMediaBytes(
  c: WpCredentials,
  bytes: Uint8Array,
  filename: string,
  contentType: string,
  altText: string | null,
): Promise<{ id: number; sourceUrl: string } | null> {
  try {
    if (!bytes.byteLength || bytes.byteLength > 15 * 1024 * 1024) return null;
    const name = filename;
    // Copy into a plain ArrayBuffer: TS's BodyInit doesn't accept a bare
    // Uint8Array view (it may sit over a SharedArrayBuffer).
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const res = await fetch(api(c, "/media"), {
      method: "POST",
      headers: {
        Authorization: authHeader(c),
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
      body: buf,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const media = (await res.json()) as { id: number; source_url: string };

    if (altText?.trim()) {
      await fetch(api(c, `/media/${media.id}`), {
        method: "POST",
        headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
        body: JSON.stringify({ alt_text: altText.trim().slice(0, 200) }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => {});
    }
    return { id: media.id, sourceUrl: media.source_url };
  } catch {
    return null;
  }
}
