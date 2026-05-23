"use server";

import { cookies } from "next/headers";

const THEME_COOKIE = "createup_theme";
export type Theme = "light" | "dark" | "auto";

export async function setThemeAction(formData: FormData) {
  const raw = String(formData.get("theme") ?? "auto");
  const theme: Theme = raw === "light" || raw === "dark" ? raw : "auto";
  const jar = await cookies();
  jar.set(THEME_COOKIE, theme, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function getTheme(): Promise<Theme> {
  const jar = await cookies();
  const v = jar.get(THEME_COOKIE)?.value;
  return v === "light" || v === "dark" ? v : "auto";
}
