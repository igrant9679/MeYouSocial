import { ImageResponse } from "next/og";

// Browser-tab favicon — the folded-broadsheet M (ink badge, coral fold).
// Rendered as a 32x32 PNG so it's crisper than favicon.ico on hi-DPI tabs.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 52 52">
          <rect width="52" height="52" rx="11" fill="#15181D" />
          <path d="M9 41 V14 L22.5 32 L27 25.5 V41 Z" fill="#FFFFFF" />
          <path d="M27 25.5 L31.5 32 L43 14 V41 H34.5 V28 Z" fill="#E5482F" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
