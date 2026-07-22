"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

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
