import { redirect } from "next/navigation";

// The Research chat (MU-07 ideation chat) was folded into the assistant on
// 2026-09-09: the assistant carries the active channel's context, reads Intel
// channels and videos, YouTube transcripts, web pages and uploads, and turns a
// conversation into a script. Old bookmarks land on the assistant.
export default function ChatListPage() {
  redirect("/assistant");
}
