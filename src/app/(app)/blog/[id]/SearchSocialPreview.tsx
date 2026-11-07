"use client";

import { useEffect, useRef, useState } from "react";
import { SERP, breadcrumb, fitWidth } from "@/lib/serp-preview";

/**
 * Search and social previews (E-ART-06): the Google result with the title and
 * description cut where Google would cut them (by width — an estimate, and
 * Google may rewrite a title), and the Facebook and LinkedIn cards from the OG
 * fields and image. They follow the settings form's fields as they're typed;
 * nothing here saves anything.
 */

type Fields = { title: string; slug: string; metaTitle: string; metaDescription: string; ogTitle: string; ogDescription: string };
const NAMES = new Set(["title", "slug", "metaTitle", "metaDescription", "ogTitle", "ogDescription"]);

export function SearchSocialPreview({ initial, site, excerpt, ogImage }: {
  initial: Fields;
  site: string | null;
  excerpt: string;
  ogImage: { url: string; width: number | null; height: number | null; role: string } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [f, setF] = useState<Fields>(initial);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && NAMES.has(t.name)) setF((prev) => ({ ...prev, [t.name]: t.value }));
    };
    form.addEventListener("input", onInput);
    return () => form.removeEventListener("input", onInput);
  }, []);

  const title = fitWidth(f.metaTitle || f.title, SERP.titlePx, SERP.titleMax);
  const ownDesc = f.metaDescription.trim();
  const desc = fitWidth(ownDesc || excerpt, SERP.descPx, SERP.descMax);
  const crumb = breadcrumb(site, f.slug);
  const domain = crumb.split(" › ")[0];
  const ogTitle = f.ogTitle || f.metaTitle || f.title;
  const ogDesc = f.ogDescription || ownDesc;
  const ratio = ogImage?.width && ogImage.height ? ogImage.width / ogImage.height : null;

  const notes: string[] = [];
  if (!f.metaTitle.trim()) notes.push("No meta title — Google shows the article title.");
  if (title.cut) notes.push(`The title is about ${title.width}px wide; Google shows about ${SERP.titleMax}px, so it ends at “${title.text}”.`);
  if (!ownDesc) notes.push("No meta description — Google picks text from the page itself (shown in italics: the opening of the article).");
  else if (desc.cut) notes.push(`The description is about ${desc.width}px; Google shows about ${SERP.descMax}px on desktop, so the end is cut.`);
  if (!ogImage) notes.push("No approved OG or featured image — the networks show a text-only card, or pick an image themselves.");
  else if (ogImage.role !== "og") notes.push("No approved OG image, so the cards use the featured image.");
  if (ratio && Math.abs(ratio - 1.91) > 0.25) notes.push(`The card image is ${ogImage!.width}×${ogImage!.height}; cards are 1.91:1 (1200×630), so it will be cropped.`);

  return (
    <div ref={ref} className="flex flex-col gap-3" data-previews>
      <div>
        <div className="text-xs text-[var(--mute)] mb-1">Google result <span className="font-mono">(desktop · cut by width, an estimate)</span></div>
        <div className="rounded-lg border border-[var(--line)] p-3 max-w-[652px]" style={{ background: "#fff", fontFamily: "Arial, Helvetica, sans-serif" }} data-serp>
          <div className="text-xs leading-tight" style={{ color: "#202124" }}>{domain}</div>
          <div className="text-xs leading-tight mb-1 truncate" style={{ color: "#4d5156" }} data-serp-crumb>{crumb}</div>
          <div className="text-xl leading-snug" style={{ color: "#1a0dab" }} data-serp-title>{title.text || "Untitled"}</div>
          <div className={`text-sm leading-normal ${ownDesc ? "" : "italic"}`} style={{ color: "#4d5156" }} data-serp-desc>{desc.text}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-60 max-w-[500px]">
          <div className="text-xs text-[var(--mute)] mb-1">Facebook</div>
          <div className="rounded-lg overflow-hidden border border-[var(--line)]" style={{ fontFamily: "Helvetica, Arial, sans-serif" }} data-card="facebook">
            <CardImage image={ogImage} />
            <div className="px-3 py-2" style={{ background: "#f0f2f5" }}>
              <div className="text-xs uppercase truncate" style={{ color: "#606770" }}>{domain}</div>
              <div className="text-base font-semibold leading-tight line-clamp-2" style={{ color: "#1d2129" }}>{ogTitle || "Untitled"}</div>
              {ogDesc && <div className="text-sm truncate" style={{ color: "#606770" }}>{ogDesc}</div>}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-60 max-w-[500px]">
          <div className="text-xs text-[var(--mute)] mb-1">LinkedIn</div>
          <div className="rounded-lg overflow-hidden border border-[var(--line)]" style={{ background: "#fff", fontFamily: "Helvetica, Arial, sans-serif" }} data-card="linkedin">
            <CardImage image={ogImage} />
            <div className="px-3 py-2">
              <div className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: "rgba(0,0,0,0.9)" }}>{ogTitle || "Untitled"}</div>
              <div className="text-xs truncate" style={{ color: "rgba(0,0,0,0.6)" }}>{domain}</div>
            </div>
          </div>
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="text-xs m-0 pl-4 flex flex-col gap-0.5" style={{ color: "var(--amber-on)" }} data-preview-notes>
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

function CardImage({ image }: { image: { url: string } | null }) {
  if (!image) return <div className="grid place-items-center text-xs text-[var(--mute)]" style={{ aspectRatio: "1.91 / 1", background: "var(--zebra)" }}>no image</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image.url} alt="" className="w-full object-cover block" style={{ aspectRatio: "1.91 / 1" }} />;
}
