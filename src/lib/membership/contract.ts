import { z } from "zod";

// What the website sends to POST /api/membership/events (2026-11-26) — the contract documented for
// the website in docs/WEBSITE-SIGNUP-INTEGRATION.md. Keep the two in step.
//
//   { "id": "evt_…",                      unique per event; a retry sends the SAME id
//     "type": "membership.activated",      ping | membership.activated | membership.deactivated | membership.link
//     "occurredAt": "2026-11-26T15:04:05Z",
//     "member": { "id": "123", "email": "ada@example.com", "name": "Ada Lovelace", "company": "Acme" },
//     "membership": { "id": "7834", "name": "Steward" } }
//
// `member.id` is the WordPress user id and `membership.id` the MemberPress membership (product) id —
// Publisher's plan mapping (Settings → Sign-ups) is keyed by the latter.

export const EVENT_TYPES = ["ping", "membership.activated", "membership.deactivated", "membership.link"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const externalId = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((v) => String(v).trim())
  .pipe(z.string().min(1).max(64).regex(/^[\w.:@-]+$/, "letters, digits and . _ : @ - only"));

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max))
    .nullish();

const when = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "an ISO 8601 date and time")
  .transform((s) => new Date(s));

export const memberSchema = z.object({
  id: externalId,
  email: z.string().trim().toLowerCase().max(254).email(),
  name: text(120),
  company: text(120),
});

export const membershipSchema = z.object({
  id: externalId,
  name: text(120),
});

const base = {
  id: z.string().trim().min(8).max(100).regex(/^[\w.:-]+$/, "letters, digits and . _ : - only"),
  occurredAt: when,
};

export const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("ping") }),
  z.object({ ...base, type: z.literal("membership.activated"), member: memberSchema, membership: membershipSchema }),
  z.object({ ...base, type: z.literal("membership.deactivated"), member: memberSchema, membership: membershipSchema }),
  z.object({ ...base, type: z.literal("membership.link"), member: memberSchema, membership: membershipSchema.optional() }),
]);

export type MembershipCall = z.infer<typeof eventSchema>;
export type MemberCall = Exclude<MembershipCall, { type: "ping" }>;

/** The first problem with a payload, in one line a developer can act on. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The payload isn't valid.";
  const where = issue.path.length ? issue.path.join(".") : "payload";
  return `${where}: ${issue.message}`;
}
