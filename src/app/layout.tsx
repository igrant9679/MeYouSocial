import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getContentSize, getTheme } from "@/app/actions/theme";
import { SIZE_ZOOM } from "@/lib/ui-size";

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "MeYouSocial",
  description: "AI-powered blog & video content platform",
  // Drives the iOS Home Screen label + standalone (fullscreen) display when
  // someone uses Safari → Share → Add to Home Screen. The actual icon comes
  // from src/app/apple-icon.tsx.
  appleWebApp: {
    capable: true,
    title: "MeYouSocial",
    statusBarStyle: "black-translucent",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Light/Dark/Auto theme. The cookie-set value drives a class on <html>;
  // CSS handles the actual palette swap in globals.css.
  const [theme, size] = await Promise.all([getTheme(), getContentSize()]);
  const zoom = SIZE_ZOOM[size];
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      {/* Content-size setting: zoom scales px-based utilities too, which a root
          font-size change would miss. 1 renders as no-op.
          ⚠ `--ui-zoom` must be set with it, never without: percentages and
          viewport units resolve against the UNZOOMED containing block, so every
          viewport-sized box needs the zoom divided back out. See the note at the
          top of globals.css — omitting this is what gave the page a horizontal
          scrollbar and cut the shell off below the fold. */}
      <body
        className="app-body flex flex-col"
        style={zoom !== 1 ? ({ zoom, "--ui-zoom": String(zoom) } as React.CSSProperties) : undefined}
      >
        {children}
      </body>
    </html>
  );
}
