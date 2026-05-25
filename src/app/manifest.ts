import type { MetadataRoute } from "next";

// Web app manifest — drives Android Chrome's "Add to Home Screen" experience
// and the iOS standalone display once added. Next auto-injects the manifest
// link tag and serves this at /manifest.webmanifest.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CreateUp",
    short_name: "CreateUp",
    description: "AI-powered YouTube research & scriptwriting",
    start_url: "/",
    display: "standalone",
    background_color: "#0F1218",
    theme_color: "#E5482F",
    icons: [
      { src: "/icon",        sizes: "32x32",   type: "image/png" },
      { src: "/apple-icon",  sizes: "180x180", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon",  sizes: "180x180", type: "image/png" },
    ],
  };
}
