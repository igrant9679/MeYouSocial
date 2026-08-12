import { redirect } from "next/navigation";

// Moved 2026-08-12: the WordPress connection is a publishing destination, so it
// lives under Distribute as /website now. This redirect keeps old links,
// bookmarks and muscle memory working.
export default function BlogSettingsRedirect() {
  redirect("/website");
}
