import { redirect } from "next/navigation";

// ⚠ The Review stage was the Inbox (audit B1.1). Both pages rendered the SAME
// <NeedsYouGroups> over the same data — Review's own docstring said they shared
// it "so the two never drift", which is precisely why they were pixel-identical
// and why the rail carried two entries to one screen.
//
// The Inbox is the landing page and keeps the cards. Review's two real tabs
// moved to the stages whose work they gate: the content Audit under Publish,
// and Approvals under Publish too until 2026-11-18, when it went to Distribute
// with the rest of a social post's pages. This URL keeps working, as every
// retired URL here does.
export default function ReviewStage() {
  redirect("/inbox");
}
