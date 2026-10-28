"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { getPostingTimeZone } from "@/lib/social/slots";
import { MEASURE_RANGE_COOKIE, rangeQuery, resolveRange } from "@/lib/measure-range";

// The pages the range picker sits on (E-MEA-01). `back` is held to these, so the
// action can't be turned into a redirect anywhere else.
const MEASURE_PATHS = /^\/(measure(\/topics)?|insights|youtube|social\/performance)$/;

/**
 * Save the Measure range and show it. The picker posts here: a preset button
 * (`range=7|28|90|365`), Apply (`range=apply` — the typed days when both are
 * there, else the preset in use), and the compare box. The choice goes into
 * the URL and a cookie, so the other Measure tabs open on it too.
 */
export async function setMeasureRangeAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const rawBack = String(formData.get("back") ?? "");
  const back = MEASURE_PATHS.test(rawBack) ? rawBack : "/measure";
  const asked = String(formData.get("range") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const current = String(formData.get("current") ?? "");
  const compare = formData.get("compare") === "1" ? "1" : undefined;
  // Apply with the shown days untouched (say, to tick "compare") keeps a preset.
  const untouched = current !== "custom" && from === formData.get("shownFrom") && to === formData.get("shownTo");
  const typed = asked === "apply" && from && to && !untouched;
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const r = resolveRange(
    typed ? { range: "custom", from, to, compare } : { range: asked === "apply" ? current : asked, compare },
    tz,
  );
  if (r.problem) redirect(`${back}?err=${encodeURIComponent(r.problem)}`);
  const q = rangeQuery(r);
  (await cookies()).set(MEASURE_RANGE_COOKIE, q, { path: "/", maxAge: 180 * 86_400, sameSite: "lax", httpOnly: true });
  redirect(`${back}?${q}`);
}
