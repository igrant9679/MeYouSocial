"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/** The phone's bottom tabs (E-SHL-10): on unless this browser turned them off. */
const TABBAR_COOKIE = "mys_tabbar";

export async function setTabBarAction(formData: FormData) {
  const on = String(formData.get("on") ?? "") === "1";
  const jar = await cookies();
  jar.set(TABBAR_COOKIE, on ? "on" : "off", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
