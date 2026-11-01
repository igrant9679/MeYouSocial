import { db } from "@/lib/db";

/**
 * Tell people the moment a social send fails (E-SOC-22). A failed or partly
 * failed post used to wait on the Sent list for someone to look; a dead account
 * waited for the half-hourly health sweep. Called wherever a post's status is
 * rolled up from its legs — the send, the reconciler and the webhook — and
 * de-duplicated per post for a day by notify (`publish_failed`), so a post
 * settled twice says it once.
 *
 * A leg whose error reads like a lost connection also raises `account_broken`
 * at once, pointing at Connections rather than the post.
 */
const RECONNECT = /reconnect|re-?auth|token|expired|unauthori[sz]ed|permission|not authorized|access denied|\b40[13]\b/i;

export async function alertSendFailure(postId: string): Promise<void> {
  try {
    const post = await db.socialPost.findUnique({
      where: { id: postId },
      select: { id: true, workspaceId: true, status: true, text: true, targets: { select: { status: true, error: true, provider: true } } },
    });
    if (!post || (post.status !== "failed" && post.status !== "partial")) return;
    const failed = post.targets.filter((t) => t.status === "failed");
    if (!failed.length) return;
    const networks = [...new Set(failed.map((t) => t.provider))].join(", ");
    const first = failed.find((t) => t.error)?.error ?? "No reason was given.";
    const { notify } = await import("@/lib/notify");
    await notify({
      workspaceId: post.workspaceId,
      kind: "publish_failed",
      title: post.status === "partial" ? `A social post went out, but not on ${networks}` : `A social post didn't go out on ${networks}`,
      body: `“${post.text.slice(0, 80)}${post.text.length > 80 ? "…" : ""}” — ${first.slice(0, 240)} Open it to retry.`,
      path: `/social/${post.id}/edit`,
      entityType: "social_post",
      entityId: post.id,
    });
    const lost = failed.filter((t) => t.error && RECONNECT.test(t.error));
    if (lost.length) {
      await notify({
        workspaceId: post.workspaceId,
        kind: "account_broken",
        title: `${[...new Set(lost.map((t) => t.provider))].join(", ")} needs reconnecting`,
        body: `A send just failed with: ${lost[0].error!.slice(0, 200)} Reconnect the account, then retry the post.`,
        path: "/setup/connections",
        // per network, so a run of failing posts says it once a day (DEDUPE_HOURS)
        entityType: "social_account",
        entityId: `${post.workspaceId}:${[...new Set(lost.map((t) => t.provider))].join(",")}`,
      });
    }
  } catch (e) {
    // An alert must never break the send it reports on.
    console.warn("[social] failure alert not sent:", e instanceof Error ? e.message : e);
  }
}
