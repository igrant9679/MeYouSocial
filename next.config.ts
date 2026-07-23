import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics (.afm files) from disk at runtime — bundling
  // it breaks those reads, so it stays an external package (node_modules is
  // present in the runtime container).
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
