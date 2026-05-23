import Link from "next/link";
import { HelpCircle, Keyboard, Lightbulb, ExternalLink } from "lucide-react";
import { setThemeAction, getTheme } from "@/app/actions/theme";

// FR-SET-03 — User Guide / Help center, in-app and contextual.
// FR-SET-01 — Theme picker lives here too.
// FR-SET-02 — Keyboard shortcut reference.

const SHORTCUTS = [
  { keys: "Ctrl/⌘+/", action: "Open the Prompt Library (in chat)" },
  { keys: "Esc",      action: "Close the Prompt Library / Improve modal" },
  { keys: "Tab",      action: "Move through form fields" },
];

const SECTIONS = [
  {
    title: "Get started in 12 minutes",
    items: [
      { label: "Create a channel", href: "/onboarding/channel/new" },
      { label: "Browse Intel for outliers in your niche", href: "/intel" },
      { label: "Start a script in the Canvas", href: "/scripts" },
      { label: "Run Agent Mode to do it all automatically", href: null, note: "Open any script → click the 'Run Agent' button in the toolbar." },
    ],
  },
  {
    title: "Voice & audience",
    items: [
      { label: "Edit your default voice profile", note: "Channel → Voice. Simple mode for natural-language tweaks; Advanced for full structured control." },
      { label: "Borrow a voice from another creator", note: "Channel → Voice → 'Borrow a voice' (sidebar). Paste any @handle." },
      { label: "Add writing samples", note: "Channel → Voice. Up to 50,000 characters per sample." },
      { label: "Refresh the audience avatar", note: "Channel → Audience → 'Refresh avatar from YT data'." },
    ],
  },
  {
    title: "Writing flow",
    items: [
      { label: "Canvas (split-panel, recommended)", href: "/scripts" },
      { label: "Script Builder Classic (10-step)", note: "Any script → 'Builder mode' link in the toolbar." },
      { label: "Highlight-and-Improve", note: "Select text in the editor → click 'Improve' or pick a quick instruction." },
      { label: "Humanize", note: "One-click rewrite that strips AI patterns and targets ~6-7th grade spoken readability." },
    ],
  },
  {
    title: "Packaging & promo",
    items: [
      { label: "Generate a thumbnail", href: "/thumbnails" },
      { label: "Export to Word / PDF / Teleprompter", note: "Any script → 'Publish' button → Export section." },
      { label: "Generate promo (titles, tags, description, social, newsletter)", note: "Any script → Publish page." },
    ],
  },
  {
    title: "Run the channel",
    items: [
      { label: "Production board (kanban)", href: "/production" },
      { label: "Content calendar",          href: "/production/calendar" },
      { label: "Tasks",                     href: "/production/tasks" },
      { label: "B-roll library",            href: "/production/assets" },
      { label: "Wiki / SOPs",               href: "/production/wiki" },
    ],
  },
  {
    title: "Growth loop",
    items: [
      { label: "Public audience-submission form", note: "Channel → Submissions tab. Share the public URL anywhere." },
      { label: "Sync stats per project", note: "Open any project on the board → 'Sync stats now'." },
      { label: "Repurpose into a Short / blog / newsletter", note: "Open a project → 'Create derivative'." },
    ],
  },
];

export default async function HelpPage() {
  const theme = await getTheme();
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#D7F1ED", color: "#0D9488" }}>
          <HelpCircle className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Help & guide</h1>
          <p className="text-xs text-[var(--mute)]">In-app reference. Click any section to jump to it.</p>
        </div>
      </div>

      {/* Theme picker (FR-SET-01) */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-[14px] mb-3">Appearance (FR-SET-01)</h2>
        <form action={setThemeAction} className="flex gap-2 items-center">
          <label className={"card cursor-pointer flex-1 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]"}>
            <input type="radio" name="theme" value="light" defaultChecked={theme === "light"} className="mr-2" />Light
          </label>
          <label className={"card cursor-pointer flex-1 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]"}>
            <input type="radio" name="theme" value="dark" defaultChecked={theme === "dark"} className="mr-2" />Dark
          </label>
          <label className={"card cursor-pointer flex-1 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]"}>
            <input type="radio" name="theme" value="auto" defaultChecked={theme === "auto"} className="mr-2" />Auto (system)
          </label>
          <button type="submit" className="btn primary">Save</button>
        </form>
      </section>

      {/* Shortcuts (FR-SET-02) */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><Keyboard className="w-4 h-4" style={{ color: "var(--accent)" }} /> Keyboard shortcuts</h2>
        <ul className="m-0 p-0">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-3 text-sm">
              <kbd className="px-2 py-0.5 rounded bg-[var(--zebra)] border border-[var(--line-2)] text-xs font-mono">{s.keys}</kbd>
              <span className="flex-1">{s.action}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Guides */}
      {SECTIONS.map((sec) => (
        <section key={sec.title} className="card mb-3">
          <h2 className="font-mono font-bold text-[14px] mb-2 flex items-center gap-2"><Lightbulb className="w-4 h-4" style={{ color: "var(--accent)" }} /> {sec.title}</h2>
          <ul className="m-0 p-0">
            {sec.items.map((item, i) => (
              <li key={i} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm">
                {item.href ? (
                  <Link href={item.href} className="font-semibold text-[var(--accent)] hover:underline flex items-center gap-1.5">{item.label} <ExternalLink className="w-3 h-3" /></Link>
                ) : (
                  <span className="font-semibold">{item.label}</span>
                )}
                {item.note && <div className="text-xs text-[var(--mute)] mt-1">{item.note}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
