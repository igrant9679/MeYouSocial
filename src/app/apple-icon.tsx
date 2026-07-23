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
          {/* Same favicon-tuned coverage as icon.tsx so tab + home screen match. */}
          <path d="M6 42 V11 L21.5 32.5 L26 26 V42 Z" fill="#FFFFFF" />
          <path d="M26 26 L30.5 32.5 L46 11 V42 H36 V27 Z" fill="#E5482F" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
