import Link from "next/link";
import {
  BookOpen, Compass, Sun, CalendarDays, CalendarRange, Wrench, Bot,
  AlertTriangle, Mail, Check, ArrowRight,
} from "lucide-react";

/**
 * The owner's guide — onboarding document + daily/weekly/monthly routine.
 *
 * A DOCUMENT, deliberately: Elsie's tours point at controls, the FAQ answers
 * single questions, Home shows today's queue — but nothing anywhere said "here
 * is the whole machine, here is your part of it, and here is what tending it
 * looks like over a day, a week and a month". This page is that. It describes
 * the app AS IT IS — approval gates, the digest's silence-is-the-signal rule,
 * pending AI images — so when the app changes behaviour, change this page in
 * the same commit.
 */

export const metadata = { title: "Owner's guide — MeYouSocial" };

export default function GuidePage() {
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <BookOpen className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">The owner&apos;s guide</h1>
          <p className="text-xs text-[var(--mute)]">How the machine works, and what tending it looks like — daily, weekly, monthly.</p>
        </div>
      </div>
      <p className="text-[11px] text-[var(--mute)] mb-5">
        Ten-minute read. For step-by-step setup with the app pointing at things, use the compass button in the
        top bar — this page is the map, not the tour.
      </p>

      {/* ── 1 · The machine ─────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-2 flex items-center gap-2">
          <Compass className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> What this app is, in one paragraph
        </h2>
        <p className="text-sm leading-[1.65] mb-3">
          MeYouSocial is a content engine that runs mostly on its own: it researches what&apos;s worth saying,
          drafts articles and social posts (with their images), schedules them, publishes them, and pulls the
          results back in. <b>Your job is decisions, not production</b> — approving, adjusting, and occasionally
          steering. The whole interface is arranged around that: the left rail reads as the pipeline
          (<b>Research → Create → Distribute → Measure</b>, plus Setup), and{" "}
          <Link href="/dashboard" className="underline">Home</Link> is a queue of exactly what&apos;s waiting on you.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12.5px]">
          <div className="border rounded-lg px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="font-semibold mb-0.5">The engine works while you don&apos;t</div>
            <div className="text-[var(--mute)] leading-snug">
              Idea discovery, article drafting (with featured + social-preview images), de-novo social posts,
              scheduled sends, evergreen recycling and engagement sync all run unattended, inside the quotas you
              set. Everything it makes <b>parks at a gate for your review</b> — nothing AI-made publishes itself
              unless you&apos;ve explicitly set a dial to auto.
            </div>
          </div>
          <div className="border rounded-lg px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="font-semibold mb-0.5">Silence means all clear</div>
            <div className="text-[var(--mute)] leading-snug">
              If something urgent is waiting, the workspace&apos;s admins get one <b>morning digest email</b> listing
              it. A quiet morning sends nothing — on purpose, so the emails that do arrive mean something. No
              email and a green <Link href="/dashboard" className="underline">Home</Link> = genuinely nothing to do.
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · Onboarding ──────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <Wrench className="w-4 h-4" style={{ color: "var(--teal-on)" }} /> Setting a workspace up, once
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          In order — each step unlocks the next. A workspace is one company: its keys, accounts, voice and
          content are its own, invisible to every other workspace.
        </p>
        <ol className="m-0 pl-5 list-decimal text-sm space-y-2.5 leading-[1.55]">
          <li>
            <b>Give it a brain.</b> <Link href="/admin/api-keys" className="underline">Admin → API keys</Link>:
            paste an AI provider key and set the default model to match it. Without one, the app produces clearly
            fake placeholder text rather than erroring — if output ever reads generic, check here first.
          </li>
          <li>
            <b>Connect where it publishes.</b>{" "}
            <Link href="/admin/connections" className="underline">Admin → Connections</Link>: social accounts
            (use this app&apos;s Connect buttons, not the provider&apos;s own dashboard) and a mailbox, which is how
            notification and digest email leaves. Your website connects under{" "}
            <Link href="/website" className="underline">Distribute → Website</Link> — WordPress directly (with your
            theme&apos;s own post template), or any other site via per-article HTML export.
          </li>
          <li>
            <b>Teach it your voice.</b> <Link href="/blog/brand" className="underline">Blog → Brand</Link>: the
            seven Motifs (your tone, editable and versioned), topics, guardrails, and the brand kit — colours,
            image dimensions, and whether AI may generate imagery (it lands as <i>pending</i> for your approval
            either way).
          </li>
          <li>
            <b>Tell it what you actually do.</b> Same page, <i>Brand context for the AI</i>: your
            differentiators, your products and what each one does, and your brand documents (upload a .docx,
            .pdf, .txt — or paste the text). Every AI feature reads this before it writes, so it stops
            describing you in generic terms. Nothing here is AI-generated on purpose: a differentiator the
            model invented would be repeated as fact everywhere afterwards.
          </li>
          <li>
            <b>Set the clock.</b> <Link href="/social/settings" className="underline">Social → Settings</Link>:
            your timezone and posting slots — the recurring times the queue sends at. Slots are wall-clock, so
            09:00 stays 09:00 through daylight-saving changes.
          </li>
          <li>
            <b>Choose your gates.</b> Same page: <i>require approval</i> keeps every social post held until an
            admin approves it (recommended with a team). On the blog side, articles always park at review —
            that gate isn&apos;t optional. <i>Queue on approval</i> decides what happens next: with it on,
            approving a post drops it straight into the next free slot; with it off (the default) approving
            leaves it a draft that still needs queueing.
          </li>
          <li>
            <b>Set the autonomy dials.</b> <Link href="/blog/automation" className="underline">Blog → Automation</Link>{" "}
            and <Link href="/social/settings" className="underline">Social → Settings</Link>: how many articles a
            week, how many social posts, whether evergreen posts recycle. Start low; raise them once you trust
            what arrives at review.
          </li>
          <li>
            <b>Wire up measurement.</b> <Link href="/admin/analytics" className="underline">Admin → Analytics</Link>:
            connect Google and set your Search Console site + GA4 property. Until then the Measure end of the
            pipeline shows dashes — a dash means &ldquo;not measured&rdquo;, never zero.
          </li>
          <li>
            <b>Invite the team.</b> <Link href="/admin" className="underline">Admin → Users</Link>. Editors can
            write, draft and propose; admins approve, send and configure. Everyone can turn the digest email
            off for themselves under <Link href="/notifications" className="underline">Notifications</Link>.
          </li>
        </ol>
      </section>

      {/* ── 3 · Daily ───────────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <Sun className="w-4 h-4" style={{ color: "var(--amber-on)" }} /> Daily — about five minutes
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          Most days this is reading one email, or opening one page. The routine is a check, not a shift.
        </p>
        <ul className="m-0 p-0 text-sm space-y-2.5">
          <Step icon={Mail} title="Read the digest, if one arrived.">
            It lists exactly what needs you, one link per item. No digest = nothing urgent — you&apos;re done, and
            that&apos;s the system working, not you missing something.
          </Step>
          <Step icon={Check} title="Work the Needs-you queue, top to bottom.">
            <Link href="/dashboard" className="underline">Home</Link> puts the urgent items first: posts held for
            approval, failed sends to retry, accounts that stopped publishing. Each card has its own button;
            when the list is empty you&apos;re caught up everywhere.
          </Step>
          <Step icon={AlertTriangle} title="Answer people the day they write.">
            <Link href="/social/engage" className="underline">Social → Engage</Link> — comments, DMs and reviews.
            The one hard deadline in the whole app lives here: Facebook and Instagram only accept a DM reply
            within <b>24 hours</b> of the person&apos;s message. The composer warns you when a window has closed.
          </Step>
        </ul>
      </section>

      {/* ── 4 · Weekly ──────────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <CalendarDays className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Weekly — about half an hour
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          The weekly pass is where you steer. Everything here feeds the engine&apos;s next seven days.
        </p>
        <ul className="m-0 p-0 text-sm space-y-2.5">
          <Step icon={Check} title="Triage the discovered ideas.">
            <Link href="/blog/ideas" className="underline">Blog → Ideas</Link>: approve the ones worth writing,
            dismiss the rest. Approved ideas are what autopilot drafts from, on your weekly budget — an empty
            approved pool means no new articles, however high the dial.
          </Step>
          <Step icon={Check} title="Review what was drafted — words, pictures and SEO together.">
            <Link href="/blog/board" className="underline">Blog → Board</Link>: each drafted article arrives with
            its featured and social-preview images (generated from an art-direction brief, waiting as{" "}
            <i>pending</i>) and its SEO metadata — meta title, description and URL slug — already filled in.
            Approve, replace or edit any of it in the post&apos;s editor; an article can&apos;t publish until its
            images and SEO checks pass. Both automations have switches on{" "}
            <Link href="/blog/automation" className="underline">Blog → Automation</Link> and{" "}
            <Link href="/blog/brand" className="underline">Brand</Link>.
          </Step>
          <Step icon={Check} title="Approve and queue the social week.">
            <Link href="/social/approvals" className="underline">Social → Approvals</Link> for anything held, then{" "}
            <Link href="/social/calendar" className="underline">Calendar</Link> to queue approved drafts into free
            slots. <b>An approved draft that was never queued will never send</b> — approval and scheduling are
            separate decisions by default, and Home warns when drafts sit idle. Turn on <i>queue on approval</i>
            in <Link href="/social/settings" className="underline">Settings</Link> to collapse the two into one.
          </Step>
          <Step icon={Check} title="Glance at what the numbers are saying.">
            <Link href="/social/performance" className="underline">Social → Performance</Link> for per-network
            engagement, and the best-time-to-post section on{" "}
            <Link href="/social/settings" className="underline">Settings</Link> once enough posts have been
            measured — it stays silent below its sample size rather than guessing.
          </Step>
        </ul>
      </section>

      {/* ── 5 · Monthly ─────────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <CalendarRange className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> Monthly — about an hour
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          The monthly pass looks backwards to adjust the machine, not the individual posts.
        </p>
        <ul className="m-0 p-0 text-sm space-y-2.5">
          <Step icon={Check} title="Read the month.">
            <Link href="/insights" className="underline">Insights</Link> and{" "}
            <Link href="/reports" className="underline">Reports</Link>: what ranked, what got clicked, which
            networks earned their place. Decide what to do <i>more</i> of — that decision feeds the next step.
          </Step>
          <Step icon={Check} title="Tune the voice and the topics.">
            <Link href="/blog/brand" className="underline">Blog → Brand</Link>: adjust Motif weights, retire
            topics that ran dry, add what the numbers say is working. The engine only sounds like this month&apos;s
            you if you tell it what changed.
          </Step>
          <Step icon={Check} title="Reconsider the dials.">
            Raise the weekly article or social quotas if review has been consistently easy; turn on evergreen
            recycling once you have a body of posts worth resurfacing. Lower anything that&apos;s been producing
            more than you can honestly review.
          </Step>
          <Step icon={Check} title="Check the plumbing.">
            <Link href="/admin/connections" className="underline">Connections</Link> for accounts nearing
            reconnection, <Link href="/admin/api-keys" className="underline">API keys</Link> for provider billing
            surprises, <Link href="/admin/analytics" className="underline">Analytics</Link> still pointing at the
            right properties, and <Link href="/admin" className="underline">Users</Link> for anyone who joined or
            left the team.
          </Step>
        </ul>
      </section>

      {/* ── 6 · How to read the app ─────────────────────────────────────── */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-[15px] mb-2 flex items-center gap-2">
          <Bot className="w-4 h-4" style={{ color: "var(--cyan-on)" }} /> Three habits that make everything easier
        </h2>
        <ul className="m-0 pl-5 list-disc text-sm space-y-2 leading-[1.55]">
          <li>
            <b>Trust the dashes.</b> A dash with a reason means &ldquo;not measured yet&rdquo; — this app never
            invents a number to fill a card, so the numbers you do see are real.
          </li>
          <li>
            <b>Check the workspace switcher before acting.</b> With more than one company on the install, the
            switcher (top left) decides whose accounts, keys and content every page shows.
          </li>
          <li>
            <b>Hard-refresh after you hear of an update.</b> A browser tab held open across a deployment can
            call actions that no longer exist — buttons fail with a &ldquo;reload this page&rdquo; style error.
            One refresh fixes it.
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/dashboard" className="btn sm primary">Open Home <ArrowRight className="w-3.5 h-3.5" /></Link>
          <Link href="/help" className="btn sm">Back to Help</Link>
        </div>
      </section>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 w-6 h-6 rounded-lg grid place-items-center flex-shrink-0" style={{ background: "var(--zebra)", color: "var(--slate)" }}>
        <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{title}</span>{" "}
        <span className="text-[var(--mute)]">{children}</span>
      </div>
    </li>
  );
}
