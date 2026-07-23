"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ContentSize } from "@/lib/ui-size";

const THEME_COOKIE = "meyousocial_theme";
export type Theme = "light" | "dark" | "auto";

export async function setThemeAction(formData: FormData) {
  const raw = String(formData.get("theme") ?? "auto");
  const theme: Theme = raw === "light" || raw === "dark" ? raw : "auto";
  const jar = await cookies();
  jar.set(THEME_COOKIE, theme, {
    httpOnly: false,                 // client-readable so the next nav reflects it immediately
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Force the root layout to re-render with the new data-theme attribute.
  revalidatePath("/", "layout");
  // Send the user back where they came from (default to /settings).
  const back = String(formData.get("return") ?? "/settings");
  redirect(back);
}

export async function getTheme(): Promise<Theme> {
  const jar = await cookies();
  const v = jar.get(THEME_COOKIE)?.value;
  return v === "light" || v === "dark" ? v : "auto";
}

// ---- Content size (3 levels) ---------------------------------------------------
// Scales the entire UI via zoom on <body> — px-based sizes included, which a
// root font-size change would miss (the app uses arbitrary px utilities widely).
// Labels/zoom factors live in src/lib/ui-size.ts ("use server" files may only
// export async functions).

const SIZE_COOKIE = "meyousocial_size";

export async function setContentSizeAction(formData: FormData) {
  const raw = String(formData.get("size") ?? "standard");
  const size: ContentSize = raw === "large" || raw === "xl" ? raw : "standard";
  const jar = await cookies();
  jar.set(SIZE_COOKIE, size, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  const back = String(formData.get("return") ?? "/settings");
  redirect(back);
}

export async function getContentSize(): Promise<ContentSize> {
  const jar = await cookies();
  const v = jar.get(SIZE_COOKIE)?.value;
  return v === "large" || v === "xl" ? v : "standard";
}
