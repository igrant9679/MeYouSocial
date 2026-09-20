import { redirect } from "next/navigation";

// ⚠ The Review stage was the Inbox (audit B1.1). Both pages rendered the SAME
// <NeedsYouGroups> over the same data — Review's own docstring said they shared
// it "so the two never drift", which is precisely why they were pixel-identical
// and why the rail carried two entries to one screen.
//
// The Inbox is the landing page and keeps the cards. Review's two real tabs,
// Approvals and the content Audit, moved under Publish — the stage whose work
// they gate. This URL keeps working, as every retired URL here does.
export default function ReviewStage() {
  redirect("/inbox");
}
