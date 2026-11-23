import { requireMembership } from "@/lib/acl";
import { frameDetails } from "@/lib/social/post-image";
import { frameSocialImage, sampleBackdrop } from "@/lib/images/social-frame";
import { parseFrameLayout } from "@/lib/social/frame";

/**
 * A sample of this workspace's branded frame on a stand-in picture (Brand → Post images), so an admin sees the
 * frame with their own logo, colours, handle and website before any post gets it — no render, nothing spent,
 * nothing stored. GET ?layout=footer|headline|bands (default: the saved layout) &shape=square|wide.
 * Members only, like every file route.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { workspace } = await requireMembership();
  const q = new URL(req.url).searchParams;
  const details = await frameDetails(workspace.id);
  const asked = parseFrameLayout(q.get("layout"));
  const layout = asked !== "off" ? asked : details.layout !== "off" ? details.layout : "footer";
  const wide = q.get("shape") === "wide";
  const [w, h] = wide ? [960, 540] : [720, 720];
  const framed = await frameSocialImage(await sampleBackdrop(w, h), {
    layout,
    headline: "Your post's headline goes here",
    brandName: details.brandName,
    logo: details.logo,
    handle: details.handle,
    website: details.website,
    networks: details.networks,
    colors: details.colors,
  });
  return new Response(new Uint8Array(framed.bytes), {
    headers: { "content-type": framed.contentType, "cache-control": "private, no-store" },
  });
}
