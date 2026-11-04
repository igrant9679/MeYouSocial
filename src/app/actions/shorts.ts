"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { cutShortCore } from "@/lib/shorts";

/** E-VID-11: cut a 30–60 s vertical Short from a long script. EDITOR, like writing one. */
export async function cutShortAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId") ?? "");
  const { workspace, user } = await requireRole("EDITOR");
  const out = await cutShortCore(workspace.id, scriptId, user.id);
  if (!out.ok) redirect(`/scripts/${encodeURIComponent(scriptId)}?flashErr=${encodeURIComponent(`No Short was made. ${out.error}`)}`);
  revalidatePath(`/scripts/${scriptId}`);
  revalidatePath("/videos");
  redirect(
    `/videos/${out.renderId}?flash=${encodeURIComponent(
      `Short cut: ${out.words} words, a ${out.seconds}-second vertical storyboard. Its script is saved beside the original; it renders with the video queue when video rendering is on (Settings → Automation), or press Render now.`,
    )}`,
  );
}
