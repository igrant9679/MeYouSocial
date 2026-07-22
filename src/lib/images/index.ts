import { env } from "@/lib/env";

// Image generation interface. Used for (thumbnails) and
// (audience photos). Mock mode returns a deterministic placeholder URL.

export type ImageGenRequest = {
  prompt: string;
  aspectRatio?: "16:9" | "1:1" | "9:16";
  /** Optional reference image (clone/remix mode). */
  referenceUrl?: string;
};

export type ImageGenResult = {
  url: string;
  width: number;
  height: number;
  provider: string;
};

export interface ImageProvider {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

function placeholder(prompt: string, aspect: string): string {
  // Deterministic data-uri-free placeholder via picsum (no key needed).
  const dims = aspect === "1:1" ? "640/640" : aspect === "9:16" ? "405/720" : "1280/720";
  const seed = encodeURIComponent(prompt.slice(0, 32) || "meyousocial");
  return `https://picsum.photos/seed/${seed}/${dims}`;
}

const mock: ImageProvider = {
  async generate(req) {
    const aspect = req.aspectRatio ?? "16:9";
    const [w, h] = aspect === "1:1" ? [640, 640] : aspect === "9:16" ? [405, 720] : [1280, 720];
    return { url: placeholder(req.prompt, aspect), width: w, height: h, provider: "mock" };
  },
};

export const images: ImageProvider = env.USE_MOCK_IMAGES ? mock : mock;
