import { redirect } from "next/navigation";

// The Drafts stage retired on 2026-11-19 (the owner's "Name by format"): it
// served articles, and its other lists belonged to other formats. What it
// listed now lives where each format's work does — articles being written on
// Articles (/publish), social drafts under Social posts → Posts → Drafts,
// scripts and renders on Video (/studio). Old links land on Articles.
export default function DraftsMoved() {
  redirect("/publish");
}
