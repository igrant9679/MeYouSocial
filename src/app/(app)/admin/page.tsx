import { redirect } from "next/navigation";

// MU-14 Users & Roles lived here and at Settings → People, mounting the same
// PeoplePanel — the duplicate this file's own comment promised would go "after
// a release" (audit B1.3). /setup/people is the survivor: it has everything
// this page had, plus the social-approval dial.
//
// ?ok= / ?err= are forwarded because /setup/people renders them as a banner.
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const qs = new URLSearchParams();
  if (ok) qs.set("ok", ok);
  if (err) qs.set("err", err);
  redirect(`/setup/people${qs.size ? `?${qs}` : ""}`);
}
