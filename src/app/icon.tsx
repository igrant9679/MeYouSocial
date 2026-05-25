import { ImageResponse } from "next/og";

// Browser-tab favicon. Next auto-injects <link rel="icon"> pointing at this route.
// Rendered as a 32x32 PNG so it's crisper than favicon.ico on hi-DPI tabs.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg,#F0623F,#C53A22)",
          borderRadius: 6,
          color: "white",
          fontSize: 22,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        ▲
      </div>
    ),
    { ...size }
  );
}
