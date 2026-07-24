import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics (.afm files) from disk at runtime — bundling
  // it breaks those reads, so it stays an external package (node_modules is
  // present in the runtime container).
  // ffmpeg-static exports the path of a binary that sits inside its own package
  // directory — bundling it rewrites that path and the spawn fails.
  serverExternalPackages: ["pdfkit", "ffmpeg-static"],
};

export default nextConfig;
