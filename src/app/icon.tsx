import { ImageResponse } from "next/og";

// Browser-tab favicon — the MeYouSocial Publish mark: the folded-broadsheet M
// (ink badge, white and coral folds) with the product chip at the corner (a
// white, ink-ringed disc carrying a coral arrow — "out into the world").
// Favicon-tuned geometry: the M fills more of the badge than the in-app
// BrandLogo (margins 6 vs 9 on the 52 grid) and the corner radius is softer,
// because at 16-32px the original margins read as a dark smudge. At 16px the
// chip is a disc with a coral dot — an arrow that small is noise. Emitted at
// three exact sizes so the browser never has to downscale.

export function generateImageMetadata() {
  return [
    { id: "16", size: { width: 16, height: 16 }, contentType: "image/png" },
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "48", size: { width: 48, height: 48 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const px = Number(await id);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width={px} height={px} viewBox="0 0 52 52">
          <rect width="52" height="52" rx="12" fill="#15181D" />
          <path d="M6 42 V11 L21.5 32.5 L26 26 V42 Z" fill="#FFFFFF" />
          <path d="M26 26 L30.5 32.5 L46 11 V42 H36 V27 Z" fill="#E5482F" />
          <circle cx="40.5" cy="40.5" r="9.5" fill="#FFFFFF" stroke="#15181D" strokeWidth="1.6" />
          {px >= 32 ? (
            <g fill="none" stroke="#E5482F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M37.3 43.7 L43.7 37.3" />
              <path d="M39.1 37.3 H43.7 V41.9" />
            </g>
          ) : (
            <circle cx="40.5" cy="40.5" r="3.2" fill="#E5482F" />
          )}
        </svg>
      </div>
    ),
    { width: px, height: px }
  );
}
