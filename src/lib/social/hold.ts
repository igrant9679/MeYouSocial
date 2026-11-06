/**
 * The hold (audit SOC-04 / E-SOC-01).
 *
 * A draft a PERSON parked — Move to drafts, Cancel, Save as draft, Hold — is
 * held: the full-autonomy sweep never gives it a slot (`queueableDrafts`
 * filters `heldAt: null`) and Queue all leaves it. Before this, each of those
 * made an undated draft that the sweep queued again within half an hour, so a
 * post someone tried to stop went out anyway.
 *
 * A person queueing, scheduling or releasing the post lets go. Drafts the
 * engine makes (auto-generation, RSS, captions, the assistant) are not held —
 * under full autonomy they are meant to be queued.
 */
export function holdBy(userId: string | null | undefined): { heldAt: Date; heldById: string | null } {
  return { heldAt: new Date(), heldById: userId ?? null };
}

export const RELEASED = { heldAt: null, heldById: null } as const;
