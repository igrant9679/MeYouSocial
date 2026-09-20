import { redirect } from "next/navigation";

// The workflow board folded into /blog on 2026-09-20 (audit B1.2): the same
// four columns existed here as a list and there as a kanban, as two tabs of
// Drafts. /blog is now one Articles page with a board/list toggle. The URL
// keeps working — old links always do.
export default function BlogBoardPage() {
  redirect("/blog?view=list");
}
