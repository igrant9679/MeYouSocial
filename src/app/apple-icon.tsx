import { ImageResponse } from "next/og";

// iOS Home Screen icon. iOS specifically looks for <link rel="apple-touch-icon"> —
// without it, "Add to Home Screen" takes a screenshot of the page. Next auto-injects
// this link tag when we ship apple-icon.tsx in the app root.
//
// 180x180 is Apple's recommended size for the highest-density iPhones.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg,#F0623F 0%,#C53A22 100%)",
          color: "white",
          fontSize: 120,
          fontWeight: 900,
          lineHeight: 1,
          // iOS rounds the corners itself; leave the square edge.
        }}
      >
        ▲
      </div>
    ),
    { ...size }
  );
}
