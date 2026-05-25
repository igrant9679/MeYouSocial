import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getTheme } from "@/app/actions/theme";

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
  title: "CreateUp",
  description: "AI-powered YouTube research & scriptwriting",
  // Drives the iOS Home Screen label + standalone (fullscreen) display when
  // someone uses Safari → Share → Add to Home Screen. The actual icon comes
  // from src/app/apple-icon.tsx.
  appleWebApp: {
    capable: true,
    title: "CreateUp",
    statusBarStyle: "black-translucent",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Light/Dark/Auto theme. The cookie-set value drives a class on <html>;
  // CSS handles the actual palette swap in globals.css.
  const theme = await getTheme();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
