import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Rendered markdown for MODEL-authored chat messages — the one place chat
 * dialogs turn `**bold**` into bold instead of showing the syntax (owner ask
 * 2026-08-25). Used by the assistant thread and chat thread pages; user
 * bubbles stay plain text on purpose (a human typing *asterisks* means
 * asterisks), and so do tool-step outputs (raw output is the point there).
 *
 * Safety: no rehype-raw, so raw HTML inside model output is never parsed
 * into the DOM — an LLM reply containing markup cannot inject elements.
 * Links force a new tab + noopener; URLs autolink via GFM.
 *
 * Styling uses the theme tokens (var(--…)) so dark mode comes free — per
 * globals.css, never raw hex. Element styles live here, not in a global
 * `.prose`, so nothing leaks outside chat.
 */
export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  // `className` REPLACES the default size class rather than stacking with it —
  // "text-sm text-xs" would resolve by stylesheet order, not call-site intent.
  return (
    <div className={(className ?? "text-sm") + " leading-relaxed break-words"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-[var(--accent)] break-all">
              {children}
            </a>
          ),
          ul: (p) => <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...p} />,
          li: (p) => <li className="[&>p]:my-0" {...p} />,
          // Chat-scale headings: distinct, but nowhere near page-chrome size.
          h1: (p) => <h3 className="font-semibold text-base mt-3 mb-1 first:mt-0" {...p} />,
          h2: (p) => <h3 className="font-semibold text-base mt-3 mb-1 first:mt-0" {...p} />,
          h3: (p) => <h4 className="font-semibold text-sm mt-2.5 mb-1 first:mt-0" {...p} />,
          h4: (p) => <h4 className="font-semibold text-sm mt-2.5 mb-1 first:mt-0" {...p} />,
          h5: (p) => <h5 className="font-semibold text-sm mt-2 mb-1 first:mt-0" {...p} />,
          h6: (p) => <h6 className="font-semibold text-sm mt-2 mb-1 first:mt-0" {...p} />,
          code: (p) => <code className="font-mono text-[0.85em] bg-[var(--zebra)] border border-[var(--line)] rounded px-1 py-px" {...p} />,
          pre: (p) => (
            <pre
              className="overflow-x-auto rounded-lg bg-[var(--zebra)] border border-[var(--line)] p-2.5 my-1.5 text-xs [&>code]:bg-transparent [&>code]:border-0 [&>code]:p-0"
              {...p}
            />
          ),
          blockquote: (p) => <blockquote className="border-l-2 border-[var(--line-2)] pl-3 my-1.5 text-[var(--mute)]" {...p} />,
          hr: () => <hr className="border-[var(--line)] my-2.5" />,
          table: (p) => (
            <div className="overflow-x-auto my-1.5">
              <table className="border-collapse text-xs" {...p} />
            </div>
          ),
          th: (p) => <th className="border border-[var(--line)] px-2 py-1 text-left font-semibold bg-[var(--zebra)]" {...p} />,
          td: (p) => <td className="border border-[var(--line)] px-2 py-1 align-top" {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
