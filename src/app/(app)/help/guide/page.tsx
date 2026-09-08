import Link from "next/link";
import {
  BookOpen, Compass, Sun, CalendarDays, CalendarRange, Wrench, Bot,
  AlertTriangle, Mail, Check, ArrowRight, Layers, ListChecks, Repeat, LifeBuoy,
} from "lucide-react";

/**
 * The owner's guide — the whole machine on one page: what it is, the seven
 * stages, setting a workspace up, the daily / weekly / monthly routines, the
 * repeatable processes, and how to read the app when something looks wrong.
 *
 * A DOCUMENT, deliberately: Elsie's tours point at controls, the FAQ answers
 * single questions, the Inbox shows today's queue — this page is the map. It
 * describes the app AS IT IS — the gates, the digest's silence-is-the-signal
 * rule, pending AI images, the strip — so when the app changes behaviour,
 * change this page (and lib/assistant/knowledge.ts) in the same commit.
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
        Fifteen-minute read. For step-by-step setup with the app pointing at things, use the compass button in the
        top bar — this page is the map, not the tour. The <Link href="/assistant" className="underline">Assistant</Link> knows
        everything on this page too: ask it &ldquo;how do I…&rdquo; or &ldquo;why is … held&rdquo;.
      </p>

      {/* ── 1 · The machine ─────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-2 flex items-center gap-2">
          <Compass className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> What this app is, in one paragraph
        </h2>
        <p className="text-sm leading-[1.65] mb-3">
          MeYouSocial is a content engine that runs mostly on its own: it researches what&apos;s worth saying,
          drafts articles and social posts (with their images and SEO), reviews its own work, schedules and
          publishes what passes, and pulls the results back in. <b>Your job is decisions, not production</b> —
          approving, answering, adjusting, occasionally steering. The whole interface is one loop: the left rail
          reads <b>Research → Ideas → Drafts → Review → Publish → Distribute → Measure</b>, with{" "}
          <Link href="/inbox" className="underline">Inbox</Link> above it (exactly what&apos;s waiting on you) and
          Setup below it (Settings, Channels, Brand, Admin — admins only).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12.5px]">
          <div className="border rounded-lg px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="font-semibold mb-0.5">The engine works while you don&apos;t</div>
            <div className="text-[var(--mute)] leading-snug">
              Every 30 minutes a sweep discovers ideas, drafts the approved ones with featured and social-preview
              images and SEO, has a vision model look at every image, sources every flagged claim from live web
              search, applies the mechanical findings, advances what passes, publishes on the publish day, writes
              and queues social posts, recycles evergreen and syncs results — inside the dials you set under{" "}
              <Link href="/setup" className="underline">Settings</Link>. Everything it cannot fix <b>parks at a gate
              for you</b>.
            </div>
          </div>
          <div className="border rounded-lg px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="font-semibold mb-0.5">Silence means all clear</div>
            <div className="text-[var(--mute)] leading-snug">
              If something urgent is waiting, the workspace&apos;s admins get one <b>morning digest email</b> listing
              it. A quiet morning sends nothing — on purpose, so the emails that do arrive mean something. No
              email and a green <Link href="/inbox" className="underline">Inbox</Link> = genuinely nothing to do.
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · The seven stages ────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <Layers className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> The seven stages, one screen each
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          Every stage page has an Overview (its own rows, the verb on the row) and a strip along the top with its
          tabs — the module pages, which kept their addresses. A <b>red badge</b> on the strip means a person must
          act; a muted one is news. Old links (Home, Blog → Automation, Social → Settings, the Social overview,
          Blog → Ideas) all redirect to the right stage.
        </p>
        <ul className="m-0 p-0 text-sm space-y-2">
          <Stage href="/research" name="Research" tabs="Intel · Bookmarks · Competitors · Chat">
            Competitor channels and the videos that beat their own average (2× is strong, 5× exceptional — measured
            or a dash, never estimated). &ldquo;Make it an idea&rdquo; turns an outlier into an article idea.
          </Stage>
          <Stage href="/ideas" name="Ideas" tabs="Keywords · Experts">
            One board for article and video ideas: Discovered → Approved → Drafted → Rejected, a format chip on
            each card. <b>Only approved article ideas are drafted, and approving is your act.</b> Discover ideas,
            generate video ideas, recompute priorities (every score shows its working).
          </Stage>
          <Stage href="/drafts" name="Drafts" tabs="Articles · Board · Scripts · Thumbnails · Videos · Production">
            Everything being written or rendered. The four studio tabs appear only when a YouTube channel exists and
            the Video studio switch under Settings is on.
          </Stage>
          <Stage href="/review" name="Review" tabs="Approvals · Audit">
            What still waits on a person after auto-review did what it could — the same cards as the Inbox, the
            action on each. Approvals for social posts; Audit for refresh / merge / retire recommendations.
          </Stage>
          <Stage href="/publish" name="Publish" tabs="Website · Blog calendar">
            Articles at final approval, when they go (the publish day, or a date you set), and what went live.
            With no WordPress: <b>Download HTML</b> and <b>Mark as published</b> on the row.
          </Stage>
          <Stage href="/distribute" name="Distribute" tabs="Compose · Calendar · Engage">
            Accounts with their health, this stage&apos;s own Needs you, the queue in your posting zone, recently
            published with failed legs called out. Engage holds comments, DMs and reviews — the 24-hour DM window
            for Facebook and Instagram lives here.
          </Stage>
          <Stage href="/measure" name="Measure" tabs="Reports · Insights · Blog analytics · Blog report · Social performance">
            Search impressions and clicks, positions and their deltas, engagement by network — measured numbers
            only. A dash means not measured yet.
          </Stage>
        </ul>
      </section>

      {/* ── 3 · The assistant ───────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-2 flex items-center gap-2">
          <Bot className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> Asking instead of hunting
        </h2>
        <p className="text-sm leading-[1.65] mb-3">
          <Link href="/assistant" className="underline">Assistant</Link> — and the Ask box at the bottom of every
          stage — is a chat that can do the work, not just talk about it. Ask <i>&ldquo;what needs my
          attention?&rdquo;</i>, <i>&ldquo;which articles are missing SEO metadata?&rdquo;</i>,{" "}
          <i>&ldquo;find three ideas about donor retention&rdquo;</i>, <i>&ldquo;draft the article about zero-volume
          keywords&rdquo;</i>, or <i>&ldquo;how do I change the publish day?&rdquo;</i> — it looks things up, writes
          them, knows this guide, and shows every step it took.
        </p>
        <p className="text-sm leading-[1.65]">
          <b>Everything it makes lands exactly where your own click would leave it</b> — an article at review, a
          social post as an unscheduled draft, images pending your approval. <b>It cannot publish, send, schedule,
          queue or approve anything</b>, delete anything, or change a setting, a key or a role; ask it to and it will
          name the page instead. Approving stays the last human act before an audience sees anything. With no
          working AI key it refuses the turn rather than guessing.
        </p>
      </section>

      {/* ── 4 · Onboarding ──────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <Wrench className="w-4 h-4" style={{ color: "var(--teal-on)" }} /> Setting a workspace up, once
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          In order — each step unlocks the next. A workspace is one company: its keys, accounts, voice, slots and
          content are its own, invisible to every other workspace. Check the workspace switcher (top left) before
          acting.
        </p>
        <ol className="m-0 pl-5 list-decimal text-sm space-y-2.5 leading-[1.55]">
          <li>
            <b>Give it a brain.</b> <Link href="/admin/api-keys" className="underline">Admin → API keys</Link>:
            paste an AI provider key and set the default model to match it. Without one the app produces clearly
            fake placeholder text rather than erroring — if output ever reads generic, check here first. A live
            web search key (Tavily or Serper) is what lets it source claims.
          </li>
          <li>
            <b>Connect where it publishes.</b> <Link href="/setup/connections" className="underline">Settings → Connections</Link>{" "}
            shows every connection the loop needs and which are missing: social accounts (use this app&apos;s Connect
            buttons, not the provider&apos;s dashboard), a mailbox (how invitations and digests leave), your website
            under <Link href="/website" className="underline">Publish → Website</Link> (WordPress, or per-article HTML
            export), analytics.
          </li>
          <li>
            <b>Teach it your voice.</b> <Link href="/blog/brand" className="underline">Brand → Tone &amp; motifs</Link>:
            the seven Motifs (your tone, editable and versioned), topics, guardrails, and the brand kit — colours,
            image dimensions, and whether AI may generate imagery (it lands as <i>pending</i> for review either way).
          </li>
          <li>
            <b>Tell it what you actually do.</b> Same page, <i>Brand context for the AI</i>: differentiators, products
            and what each does, brand documents. Every AI feature reads this before it writes. Nothing here is
            AI-generated on purpose: an invented differentiator would be repeated as fact everywhere afterwards.
          </li>
          <li>
            <b>Set the clock.</b> <Link href="/setup/schedule" className="underline">Settings → Schedule</Link>:
            timezone and posting slots — the recurring times the queue sends at. Slots are wall-clock, so 09:00
            stays 09:00 through daylight-saving changes.
          </li>
          <li>
            <b>Choose your gates.</b> <Link href="/setup/people" className="underline">Settings → People</Link>:{" "}
            <i>require approval</i> holds every social post until an admin approves it (recommended with a team).
            Articles always park at review — that gate isn&apos;t optional. <i>Queue on approval</i> under{" "}
            <Link href="/setup/automation" className="underline">Automation</Link> makes approving the last act: with it
            off, an approved post still needs queueing.
          </li>
          <li>
            <b>Set the autonomy dials.</b> <Link href="/setup/automation" className="underline">Settings → Automation</Link>:
            how many articles a week and on which day, how many social posts, whether evergreen recycles, the four
            function modes — or one switch, <b>full autonomy</b>, which sets them all and remembers what you had.
            Start low; raise once you trust what arrives at review.
          </li>
          <li>
            <b>Wire up measurement.</b> <Link href="/admin/analytics" className="underline">Admin → Analytics</Link>:
            Search Console site + GA4 property, with the service account granted on both. Until then Measure shows
            dashes — a dash means &ldquo;not measured&rdquo;, never zero.
          </li>
          <li>
            <b>Invite the team.</b> <Link href="/setup/people" className="underline">Settings → People</Link>. Editors
            write, draft, answer and propose; admins approve, publish and configure. Everyone can turn the digest
            email off for themselves under <Link href="/notifications" className="underline">Notifications</Link>.
          </li>
        </ol>
      </section>

      {/* ── 5 · Daily ───────────────────────────────────────────────────── */}
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
          <Step icon={Check} title="Work the Inbox, top to bottom.">
            <Link href="/inbox" className="underline">Inbox</Link> puts the urgent items first, each with its own
            button: approve or request changes on posts; answer a question in your own words (saved to the Experts
            profile, asked once); verify a claim with a real URL or drop it; approve or replace a held image; open an
            article whose card names a check only a person can fix. The header count should reach zero.
          </Step>
          <Step icon={AlertTriangle} title="Answer people the day they write.">
            <Link href="/social/engage" className="underline">Distribute → Engage</Link> — comments, DMs and reviews.
            The one hard deadline in the whole app: Facebook and Instagram only accept a DM reply within{" "}
            <b>24 hours</b> of the person&apos;s message.
          </Step>
          <Step icon={Bot} title="Ask, if you'd rather not hunt.">
            <Link href="/assistant" className="underline">Assistant</Link> answers &ldquo;what needs my
            attention?&rdquo; from the same data and will do the next step — draft the idea, fill in the missing
            SEO — while leaving every result at the gate you review it from.
          </Step>
        </ul>
      </section>

      {/* ── 6 · Weekly ──────────────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <CalendarDays className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Weekly — about half an hour, the day before the publish day
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          The weekly pass is where you steer. Everything here feeds the engine&apos;s next seven days.
        </p>
        <ul className="m-0 p-0 text-sm space-y-2.5">
          <Step icon={Check} title="Triage the discovered ideas.">
            <Link href="/ideas" className="underline">Ideas</Link>: approve the ones worth writing, reject the rest.
            Approved ideas are what the autopilot drafts from on your weekly target — an empty Approved column means
            no new articles, however high the dial. Keep three to five approved.
          </Step>
          <Step icon={Check} title="Read what was drafted — words, pictures and SEO together.">
            <Link href="/blog/board" className="underline">Drafts → Board</Link>: each article arrives with its
            featured and social-preview images and its SEO filled in, and auto-review has already fixed what it
            could. In the article&apos;s <b>Optimize</b> tab, answer the knowledge cards and decide the strategic
            ones; the mechanical ones apply on their own.
          </Step>
          <Step icon={Check} title="Approve and queue the social week.">
            <Link href="/social/approvals" className="underline">Review → Approvals</Link> for anything held, then{" "}
            <Link href="/social/calendar" className="underline">Distribute → Calendar</Link> to queue approved drafts
            into free slots. <b>An approved draft that was never queued will never send</b>; turn on <i>queue on
            approval</i> under <Link href="/setup/automation" className="underline">Settings → Automation</Link> to
            collapse the two.
          </Step>
          <Step icon={Check} title="Confirm the publish day's article is ready.">
            <Link href="/publish" className="underline">Publish</Link>: the article due should be at final approval.
            With no WordPress, download the HTML, add it to the site, and Mark as published with the live link.
          </Step>
          <Step icon={Check} title="Glance at what the numbers are saying.">
            <Link href="/social/performance" className="underline">Measure → Social performance</Link> for per-network
            engagement, and the best-time-to-post section under{" "}
            <Link href="/setup/schedule" className="underline">Settings → Schedule</Link> once enough posts are
            measured — it stays silent below its sample size rather than guessing.
          </Step>
          <Step icon={Check} title="Skim the outliers.">
            <Link href="/research" className="underline">Research</Link>: the strong ones, and whether any fits a
            Topic well enough to become an idea.
          </Step>
        </ul>
      </section>

      {/* ── 7 · Monthly ─────────────────────────────────────────────────── */}
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
            <Link href="/blog/brand" className="underline">Brand → Tone &amp; motifs</Link>: adjust Motif weights, retire
            topics that ran dry, add what the numbers say is working, refresh the brand context. The engine only
            sounds like this month&apos;s you if you tell it what changed.
          </Step>
          <Step icon={Check} title="Reconsider the dials.">
            <Link href="/setup/automation" className="underline">Settings → Automation</Link>: raise the weekly
            article or social targets if review has been consistently easy; turn on evergreen recycling once you
            have a body of posts worth resurfacing; lower anything producing more than you can honestly review.
          </Step>
          <Step icon={Check} title="Check the plumbing.">
            <Link href="/setup/connections" className="underline">Settings → Connections</Link> for anything missing or
            nearing reconnection, <Link href="/admin/api-keys" className="underline">API keys</Link> for provider
            billing surprises, <Link href="/admin/analytics" className="underline">Analytics</Link> still pointing at
            the right properties, and <Link href="/setup/people" className="underline">People</Link> for anyone who
            joined or left.
          </Step>
          <Step icon={Check} title="Run a content audit.">
            <Link href="/blog/audit" className="underline">Review → Audit</Link>: act on the refresh, merge and retire
            recommendations before the archive goes stale.
          </Step>
        </ul>
      </section>

      {/* ── 8 · Repeatable processes ────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-1 flex items-center gap-2">
          <Repeat className="w-4 h-4" style={{ color: "var(--cyan-on)" }} /> Repeatable processes
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">The same few sequences, every time. Each one ends at a gate you can see.</p>
        <ul className="m-0 p-0 text-sm space-y-2.5">
          <Step icon={ListChecks} title="An article, end to end.">
            Ideas (approve) → the sweep drafts it, or <i>Send to draft</i> → auto-review fills SEO, renders images,
            sources claims → the Inbox shows anything it couldn&apos;t fix → you answer, verify or approve → it
            advances to final approval → the publish day (or <i>Publish now</i>) → Publish shows the live link → social
            variants follow under the social mode.
          </Step>
          <Step icon={ListChecks} title="A held article you want out anyway (admin).">
            Inbox or Review → the held-article card → an optional reason → <i>Advance anyway</i>. It records who,
            when and why on the article and in the audit log, moves it to final approval now, and carries through
            the sweep and publishing. Every clearing act — answering or dismissing a question, verifying or
            dropping a claim, approving an image — also moves the article at once when it was the last thing
            holding it; nothing waits for the next sweep.
          </Step>
          <Step icon={ListChecks} title="A held image.">
            Inbox → <i>Images that need your eye</i> → Approve, or <i>Pick or upload instead</i> in the article. The
            brake means auto-review already spent up to three renders on it.
          </Step>
          <Step icon={ListChecks} title="A claim with no source.">
            Inbox → <i>Claims with no source</i> → Verify with a URL that genuinely supports the sentence, or Drop the
            claim (removes the marker and the record; edit the sentence in the article if it should go). The next
            sweep advances the article.
          </Step>
          <Step icon={ListChecks} title="Publishing without WordPress.">
            Publish → <i>Download HTML</i> (self-contained: meta, Open Graph, images embedded; add <code>?fragment=1</code>{" "}
            for just the body) → add it to the site → <i>Mark as published</i> with the live URL. Upload the Open Graph
            image to the site for social previews; crawlers ignore embedded images.
          </Step>
          <Step icon={ListChecks} title="A new competitor.">
            Research → Intel → add by @handle or keyword → outliers appear as videos index → Bookmark the keepers →
            <i>Make it an idea</i>, or open the video and chat with its transcript.
          </Step>
          <Step icon={ListChecks} title="Changing the cadence.">
            Settings → Automation for the weekly article target and the publish day, and the social posts per week;
            Settings → Schedule for the slots they go into. Under full autonomy nothing else is needed.
          </Step>
          <Step icon={ListChecks} title="A script through the studio.">
            Ideas (video) → <i>Write</i> → the script canvas or builder → Thumbnails (Clone looks at your reference) →
            Production (Writer&apos;s Room → Film Queue → Edit Bay → Calendar) → Videos (a Veo render from a storyboard).
          </Step>
          <Step icon={ListChecks} title="Running the loop by hand.">
            Settings → Automation → <i>Run cycle now</i>, then watch Drafts and the Inbox. An idle sweep is silent by
            design — other activity (analytics and performance syncs) shows the scheduler is alive.
          </Step>
        </ul>
      </section>

      {/* ── 9 · Troubleshooting ─────────────────────────────────────────── */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[15px] mb-2 flex items-center gap-2">
          <LifeBuoy className="w-4 h-4" style={{ color: "var(--rose-on)" }} /> When something looks wrong
        </h2>
        <ul className="m-0 pl-5 list-disc text-sm space-y-2 leading-[1.55]">
          <li><b>Output reads generic or mentions &ldquo;mock&rdquo;</b> — no working AI key for this workspace. Admin → API keys, and match the model.</li>
          <li><b>Nothing is being drafted</b> — the Approved column is empty, the weekly target or daily budget is reached, drafting is on manual, or global pause is on. Settings → Automation says which.</li>
          <li><b>An article is held with nothing to act on</b> — the Inbox card names the failing check. A flagged claim needs a live-search key to be sourced; give it one sweep, then verify or remove the sentence yourself.</li>
          <li><b>At final approval but never publishes</b> — not the publish day yet, or no WordPress (Download HTML + Mark as published), or publishing isn&apos;t on auto.</li>
          <li><b>Social posts never send</b> — no slots or timezone, a post awaiting approval, approved but never queued, or a broken account (the chip on Distribute is red on the provider&apos;s own verdict, never on a token-expiry note alone).</li>
          <li><b>Measure shows dashes</b> — analytics not connected, or the Search Console property is missing the service account; Admin → Analytics runs the live probe that says which.</li>
          <li><b>A button does nothing after an update</b> — a tab held open across a deployment. Reload.</li>
          <li><b>Trust the dashes.</b> A dash with a reason means &ldquo;not measured yet&rdquo; — this app never invents a number to fill a card, so the numbers you do see are real.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/inbox" className="btn sm primary">Open Inbox <ArrowRight className="w-3.5 h-3.5" /></Link>
          <Link href="/help" className="btn sm">Back to Help</Link>
        </div>
      </section>
    </div>
  );
}

function Stage({ href, name, tabs, children }: { href: string; name: string; tabs: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Link href={href} className="font-mono text-[12px] font-bold px-2 py-0.5 rounded-md shrink-0 mt-0.5 hover:underline" style={{ background: "var(--zebra)" }}>{name}</Link>
      <div className="flex-1 min-w-0">
        <span className="text-[var(--mute)]">{children}</span>
        <div className="text-[10.5px] font-mono text-[var(--mute)] mt-0.5">{tabs}</div>
      </div>
    </li>
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
