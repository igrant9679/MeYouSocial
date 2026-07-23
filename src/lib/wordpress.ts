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
  try {
    const src = await fetch(imageUrl, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!src.ok) return null;
    const buf = await src.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 15 * 1024 * 1024) return null;
    const { name, mime } = filenameFor(imageUrl);
    const contentType = src.headers.get("content-type")?.split(";")[0] || mime;

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
