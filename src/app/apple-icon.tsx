import { ImageResponse } from "next/og";

// iOS Home Screen icon — the folded-broadsheet M. iOS specifically looks for
// <link rel="apple-touch-icon">; Next auto-injects it for apple-icon.tsx.
// 180x180 is Apple's recommended size; iOS rounds the corners itself.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#15181D" }}>
        <svg width="180" height="180" viewBox="0 0 52 52">
          <rect width="52" height="52" fill="#15181D" />
          <path d="M9 41 V14 L22.5 32 L27 25.5 V41 Z" fill="#FFFFFF" />
          <path d="M27 25.5 L31.5 32 L43 14 V41 H34.5 V28 Z" fill="#E5482F" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
