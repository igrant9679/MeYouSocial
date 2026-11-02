# Invariants — shipped rules that must not regress

_Split out of `CLAUDE.md` on 2026-10-30 so a fresh session does not load ~18K tokens of
history before starting work. `CLAUDE.md` carries a one-line index of everything here._

Each section records behaviour that was audited, fixed and verified. Read the relevant one
before changing code in that area.

## ⚠ Nav invariants after the 2026-09-20 UX audit
- **The rail is 12 entries, not 14.** `Review` and `Publish Admin` are gone. Review WAS the Inbox
  — both rendered the same `<NeedsYouGroups>` — so `/review` redirects to `/inbox`, and its tabs
  (Approvals, Audit) are Publish's.
- **One Articles page.** `/blog` takes `?view=board` (default) or `?view=list`; `/blog/board`
  redirects. `stages.ts` has ONE Drafts tab for it, with `also: ["/blog/board"]`.
- **Every retired URL still resolves** via a page-level `redirect()` — there is no `redirects()`
  block in `next.config.ts` and never has been. `/dashboard`, `/review`, `/blog/board`, `/admin`,
  `/blog/automation`, `/blog/settings`, `/social`, `/social/settings`.
- **One "Ask" at any width**: header button `md:` and up, floating dock pill below it. The stage
  Ask drawer is deleted. `.btn` is unlayered, so the header button needs `!hidden md:!inline-flex`.
- **Empty states go through `components/EmptyState.tsx`** — one sentence saying WHY, and at most
  one primary button. `action={null}` with a `note` when the viewer genuinely can't act.

## ⚠ Topics are the spine (2026-09-21 — design doc "Topics as the spine")
- **Topics live under Ideas** (`/ideas/topics`, per-Topic page `/ideas/topics/[id]`), not Brand.
  Brand keeps a one-line pointer with `id="topics"`. The actions stayed in `actions/brand-hub.ts`
  and redirect through `topicBack()` — pass a hidden `back` field, held to `/ideas*` or `/brand*`.
- **Three idea tables, one board.** `BlogIdea` (article), `Idea` (video), `SocialIdea` (social) —
  `lib/ideas-board.ts` renders them as Topic LANES. Don't merge the tables; don't add a fourth
  vocabulary. The "No topic yet" lane is `topicId: null` EXPLICITLY (NOT/notIn drops NULLs).
- **Every engine-written idea carries a Topic.** Ideation runs per Topic × format through
  `lib/ideation.ts` (`runIdeation`, emptiest cells first, bounded per call); the unfocused
  `discoverIdeasCore(ws, null)` is the fallback for a workspace with no Topics only. Video ideas
  are tagged at birth by keyword match (`lib/topic-match.ts`) — computed, labelled, never stored
  as a fact elsewhere.
- **Counts across all three formats**: the `/ideas` badge (`stage-counts.ts`), the Inbox
  "ideas to triage" card and pipeline strip (`home.ts`). A video idea's "discovered" is `new`.
- **A social post starts as an idea.** Sweep step 3 in `blog-autopilot.ts` is ideation
  (`social/ideation.ts`: per Topic, and a published article's angles) → the gate
  (`ideas:social_gate`, `social/gate.ts`: `auto` default approves the ENGINE's own ideas in the
  same sweep; `human` leaves them on the board; a person's ideas always wait for that person) →
  drafting (`social/drafting.ts`: one approved idea per sweep → a post, written exactly as
  autogen wrote it, same weekly quota). `social/autogen.ts` (Topic rotation) and
  `generateVariantsCore` are the ROLLBACK behind `social:source = rotation` — set only by an
  operator, never from the UI. Full autonomy sets the gate to `auto` and snapshots it.
- **Measure → Topics** (`lib/topic-measure.ts`, `/measure/topics`): every cell measured or a
  dash with the reason; YouTube numbers are matched to a Topic BY KEYWORD (`kw`) because no
  link exists from a render to the uploaded video — labelled, never stored.

## ⚠ Socialmonials parity (2026-10-17 — the team's white-label posting tool, brought in)
- **`platformSpecificData` is built ONLY in `lib/social/platform-options.ts`** (`buildPlatformData`).
  Zernio stores unknown keys silently, so every field there is one docs.zernio.com documents:
  `firstComment` (Facebook, Instagram, LinkedIn, YouTube — not Stories, not X, not TikTok),
  `tiktokSettings` (privacy has NO default by TikTok's rules; duet/stitch/AI flag only for video),
  `contentType` (story/reel). "Move link to first comment" runs AFTER UTM tagging.
- **Optimal = the measured best time only** (`lib/social/optimal.ts` over `best-time.ts`), else the
  composer says why. Never a guessed hour.
- **Watermark** is composited at SEND onto the uploaded copy (`lib/social/watermark.ts`); the
  stored original is untouched. Client components import positions from `watermark-options.ts`
  — importing `watermark.ts` pulls `sharp` into the browser bundle and the build fails.
- **Categories** are a workspace list (`social:categories`, `lib/social/categories.ts`), still the
  slot lane. **`SocialPost.source`** is stamped on every creation path; `post-lists.ts` derives it
  for older rows. Queue/Sent/Drafts: one component, `components/PostList.tsx`.
- **⚠ Full autonomy auto-queues every UNSCHEDULED draft** (blog-autopilot 3¾). Anything that
  saves date-bound drafts (Caption Studio) keeps `scheduledAt` on the draft — a draft with a time
  is never auto-queued, the same convention the approval workflow uses for held posts.
- **Caption Studio** (`/social/captions`, `lib/caption-studio/*`, `actions/caption-studio.ts`):
  the team's "Caption Prompts & Scenarios" doc — special days (SpecialDay rows; pasted dates are
  never guessed, rolled-forward ones are unverified), weekly campaign, from image descriptions,
  event countdown. Output is a CaptionBatch reviewed before any post exists; flags come from
  `checks.ts` and are shown, never auto-fixed. X gets the batch's short version or is left off.

## ⚠ Security invariants (2026-10-25, audit Phase 0 — `docs/AUDIT-2026-10-25.md`)
- **Fail closed on config.** `AUTH_SECRET` has no default (empty → Auth.js refuses requests);
  `USE_MOCK_LLM` defaults to false. Never reintroduce a fallback secret or a mock-by-default flag.
- **Sign-up is by invitation** unless `ALLOW_OPEN_SIGNUP=true` (default off). The form also opens
  for the very first account on an empty install. An invitation is claimed ONLY with its token
  (`/signup?invite=…`, `/invitations/<token>` signed in as the invited address) or after the address
  is verified (`verifyEmailAction`). Never claim by typed email. All three doors go through
  `lib/invitations.ts` `claimInvitation` — atomic, and it never lowers an existing active role.
  Revoking/removing a member withdraws their pending invitations.
- **Stored HTML is stripped of executable markup** by `lib/html-safety.ts` `stripExecutableHtml`:
  on body save (both actions), in the rich editor's seed, in `renderForPublish` and both exports,
  and first inside `sanitizeRichHtml`. It is a denylist that keeps sections/styles/ids — don't swap
  it for the allowlist on the body. ⚠ The Write/Edit tools turn ` `-style escapes into literal
  characters; that file uses numeric code-point checks on purpose.
- **Assistant confirmations**: a proposal runs only when the whole reply is a bare yes
  (`isAffirmative`), expires after 15 minutes, and is claimed atomically from the thread before it
  runs. `schedule_article` is ADMIN-only; tool times without a zone are read in the posting timezone.
- **Tenant boundaries on shared platform accounts**: only the operator adopts unclaimed Unipile
  mailboxes; the hosted-auth callback needs the single-use `<workspaceId>:<nonce>` it was issued
  and never reassigns an owned account. Analytics never falls back to the shared platform service
  account unless the operator lists the workspace in the platform Setting
  `analytics:platform_sa_workspaces`; site/property/OAuth identity keys are workspace-only
  (`WORKSPACE_ONLY_KEYS` in `lib/settings.ts`). YouTube/Analytics OAuth `state` is a single-use
  nonce (`lib/google/oauth-state.ts`). SMTP save/test reuse a stored password only from the
  workspace's own row with the same host+user, and refuse private hosts (`lib/net/public-host.ts`).

## ⚠ One actor at a time (2026-10-26, audit Phase 1, first part)
- **Article publishing is claimed**: `publishCore` moves the post final_approval/published →
  `"publishing"` with a conditional update before anything touches WordPress, releases it on every
  failure, and refuses any post that already has a `wpPostId`. Before creating it asks
  `wpFindRecentPostBySlug` (same slug + title, modified in the last 2 h) and adopts that post, so a
  create that timed out after succeeding isn't repeated. A claim older than 15 minutes is released by
  the sweep (`releaseStalePublishClaims`). "publishing" is a transient BlogPost status — lists may not
  show it.
- **One autopilot cycle per workspace**: `runAutopilotCycle` takes the lock
  `autopilot-cycle:<workspaceId>` for every entry point (sweep, "Run cycle now", the assistant); a
  second caller gets `skipped: "busy"`.
- **Social sends are claimed**: only the scheduler passes `{ claimed: true }`; every other
  `publishSocialPost` caller claims draft/scheduled/failed/partial → publishing atomically and stops if
  it loses. A post with no targets goes back to draft instead of sending. The scheduled-send sweep
  skips globally paused workspaces.
- `lib/redis.ts` resets `authed` with every new socket — a dropped connection used to leave every lock
  "unavailable" until a restart.
- **Article ideas become articles only through `draftIdeaCore`** (`lib/idea-drafting.ts`) — the sweep,
  Draft now, Auto-draft approved and the assistant. It claims the idea (conditional update), copies the
  Topic, audience, tier and motifs into the post and gives the writer the angle. `ideaChange()` decides
  what an idea means: a **refresh** (has `refreshPostId`) revises that published post in place —
  `refreshStartedAt` set, back through review, and its publish **updates the same WordPress post**
  (`wpUpdatePost`; the publish sweep picks refreshes up too). A typed "Refresh: / Rewrite: <title>"
  idea is linked to its article by exact bare title (`linkRefreshTargets`, lib/idea-drafting.ts — one
  published article, case and quotes aside; a person's own `refreshPostId` is never replaced) and
  becomes a refresh. **Retire / Merge, or a Refresh / Rewrite matching no article (or more than one),
  are site changes** a person makes in WordPress — never drafted. Rescoring keeps a refresh idea's
  `refreshPostId`.
- **Renders are claimed** queued → rendering; a retry skips scenes already `done` with output; a render
  stuck in "rendering" over an hour is released to **failed** (not queued — a person retries it).
- **The global pause is enforced at the routers**: `llm.complete/stream` and `images.generate` throw
  `GenerationPausedError` for a paused workspace. Only the assistant's own conversation passes
  `allowWhilePaused`; its tools are gated in `runTool`, where a tool marked `deescalates` (unschedule,
  reject, autonomy/function off, the pause itself) still runs. Paused workspaces' jobs wait unclaimed and
  the sweep skips them; the evergreen recycler skips them.
- **Assistant "draft" tools ask first when the engine would ship the result** (`confirmWhen`):
  draft_social_post and draft_article under full autonomy; advance_article and answer/dismiss_finding
  when publishing is on auto.
- The pause and full-autonomy forms post the state they mean (`intent`); a stale tab can't flip them
  back. `enableFullAutonomy` is a no-op when already on, so the restore point survives.
- **Any fetch of an outside address goes through `safeFetch`** (`lib/net/safe-fetch.ts`): public hosts
  only, every redirect hop re-checked. Stored files are served with `nosniff` + a sandbox CSP, and
  logos are PNG/JPEG/WebP only (an SVG can carry script).
- Assets have an owner (`Asset.workspaceId`); every asset read and write filters on it. Ids taken from
  a form (upload chat/script/channel, task project/assignee, bookmark targets, script template/voice)
  are checked against the workspace before the write.
- **A script is snapshotted before anything overwrites it** (`snapshotScript`, `lib/script-versions.ts`)
  — regenerate, stream, the agent, the builder — and every snapshot can be viewed and restored. "▶
  Produce video" is gone: it re-ran the writing agent and made no video.
- Zernio: `ensureZernioProfile` never adopts another workspace's `ws_*` profile, and adopts an unclaimed
  one only on the workspace's own key.
- **An approval covers what was reviewed** (2026-10-27, Phase 1 third part): with `social:require_approval`
  on, a non-admin's edit that changes an approved post's text, media, first comment or networks sends
  it back to pending (and so does scheduling a post nobody reviewed — the calendar drag and the
  assistant's queue/schedule tools refuse it like the Queue button). An auto-image landing on a post a
  reviewer approved re-pends it. RSS drafts are stamped pending while the workflow is on. The
  scheduled-send sweep still sends `approval = null` — engine posts carry null and the engine's own
  idea gate governs them. ⚠ The hold state (SOC-04) is still NOT built — don't add one without the owner.
- **A dated draft keeps its date**: Queue all drafts / bulk Queue schedule a draft that has a
  `scheduledAt` AT that time (skipped once past); only undated drafts take slots. Caption Studio never
  saves a special-day or countdown caption without its time and skips one whose day has passed.
- **Social sends**: the Zernio request id is built from STORAGE KEYS (upload URLs change per attempt);
  a 200 replay keeps each leg's own status; a timeout/abort is recorded as "may have posted anyway" and
  Retry warns (`lib/social/unknown-outcome.ts`). `reconcileStuckSocialPosts` (social sweep) settles posts
  quiet in "publishing" for 15 min from `GET /posts/{id}` (probed 2026-10-27) — it never sends.
- **An article's approval covers its words** (ART-09/21): "Advance anyway" is pinned to `gateOverrideHash`
  (md5 of the body); `returnToReviewAfterEdit` (lib/blog-gates.ts) sends a final-approval article back to
  review — clearing `scheduledAt` and the override (`CLEAR_APPROVAL`) — after Save, autosave, version
  restore, Regenerate, the craft/optimize buttons and the assistant's set_article_fields, and turns an
  edit to a live WordPress article into a refresh. Back out of final approval clears them too. Regenerate
  on a live article revises it (refresh brief). "Live" is `refreshableLive`: on WordPress through the
  app, or published by hand with a `publishedUrl` (2026-10-31, `cea7f51`) — only one marked published
  with no link is refused. A hand refresh goes out via Download HTML + "Mark as refreshed", which keeps
  the original `publishedAt`, clears `refreshStartedAt` and audits `blog.refreshed_manually`;
  `publishCore`, the publish action and the sweep refuse to send a hand refresh (`refreshStartedAt` set,
  `wpPostId` null) to WordPress, which would make a second article at a new URL.
- **Held articles are named** (ART-08): auto-review takes the least recently reviewed (`autoReviewedAt`),
  sets aside day-held claims before taking three, and the publish step runs `blockingChecks` before picking
  two (skips workspaces with no WordPress); /publish and the Inbox show the failing check at final approval.
- **Article variants post through the social pipeline** (ART-11): ADMIN, article published with its URL;
  `postSocialVariantAction` creates a SocialPost and calls `publishSocialPost` (claim, UTM, guards).

## ⚠ Times, mail and the engine's failures (2026-10-27, audit Phase 2, first part)
- **A typed date-time is wall clock in the POSTING timezone** (`social:timezone`), never the server's UTC:
  `parseZonedInput` / `toZonedInput` in `lib/social/slots.ts` — the composer and edit page, the article
  schedule, CSV import (one shape only, `2026-12-11 09:00`; `11/12/2026` is refused, not guessed) and the
  assistant all go through it, and the fields are labelled with the zone. The calendar drag still sends an
  instant computed in the browser — that one is right as it is.
- **App mail (reset, verification) leaves from a mailbox of the person's OWN workspace** (`appEmailFor`,
  `lib/email`) — never another company's. No mailbox → mock, and the forgot page says to ask an admin.
  Admins have **Reset link** on Settings → People (`lib/password-reset.ts`): refused for yourself, the
  platform operator, and anyone who also belongs to a workspace the admin doesn't administer — a reset
  link IS the account. Token helpers live outside the "use server" file on purpose.
- **A mocked send is not a delivery**: `notify()` stamps `emailedAt` only on mail that left; the digest
  records `notify.digest_undeliverable` (once a day) instead of `digest_sent`. `publish_failed` is deduped
  per entity + title for 24 h (`DEDUPE_HOURS` in `lib/notify.ts`).
- **Analytics sources sync independently** (`lib/analytics/sync.ts`): a failed source keeps its earlier
  numbers, the other replaces its own; pages are fetched in full (`gscQueryAll` / `ga4RunReportAll`) and URL
  variants of one post ADD. The last outcome per source is `analytics:sync_status` — the Analytics tab
  shows it, Insights names a failing sync instead of "connect", the Inbox warns after two failures.
- **The daily AI budget gates generating only**, counts only unattended work (`actorId: null` — so
  `blog.draft_generated` / `social.variants_generated` now carry the person who asked) from midnight in the
  posting timezone. Publishing, advancing and queueing run regardless; the report says `budgetReached`.
- **Each autopilot step runs on its own** (`step()` in `runAutopilotCycleUnlocked`): a throw is recorded in
  `failedSteps` and `autopilot:cycle_status`; the Inbox warns after two cycles. A throw inside drafting
  puts the idea back like a refusal (reason `error`).
- **Job retries back off** (`Job.runAfter`: 1, 4, 16 min ±20%). The sweep skips a job until then.

## ⚠ What reaches people is real, and nobody's edit is undone (2026-10-27, audit Phase 2, second part)
- **A placeholder is never stored as output.** The agent job, onboarding (voice, audience, starter ideas)
  and the canvas chat resolve a model the workspace can reach (`resolveUsableModel`), give long output
  `timeoutMs`, and stop on `provider === "mock"` before writing — the agent run fails naming the step;
  the chat stores a "(No answer…)" line; onboarding keeps its baseline, which is flagged `placeholder: true`
  and labelled on the audience page. Starter ideas are JSON with a seed number: an idea carries the outlier
  figure of the seed IT adapts or none, and real ideas replace the five generic ones.
- **Uploads**: images are captioned by a vision model (`askAboutImage`) or stored without a caption and
  said so; PDF and Word are refused (no parser installed) instead of stored as a stub. Chat context items
  are read (`fetchPageText`, the research row's content) or labelled unreadable. Mock search is labelled.
- **Conversations load the NEWEST N messages** (desc + take + reverse) — assistant turn, dock reload, canvas
  chat, the script page's chat pane.
- **The article editor never writes over text it didn't start from** (ART-01/03): `BlogBodyEditor` gets
  `serverHash` (bodyHash of the stored body) and sends `baseHash` with autosave and Save; the server refuses a
  stale base, keeps the person's text as the version "your edit, kept — the article changed elsewhere", and
  the editor offers Load the latest / Keep mine. A new stored body with nothing unsaved is simply loaded.
  Pending typing is flushed on unmount and when the tab hides; leaving with unsaved text warns; a failed
  autosave says so. Each AI draft is kept as a version.
- **Source markers** (ART-19/20): ONE tolerant pattern (`markerRegex` / `countMarkers` / `hasMarker` in
  `lib/citations-extract.ts`) — [Needs Source], [NEEDS SOURCE: …], [NEEDS CITATION], [citation needed] — used
  by the gate, the extractor, auto-review and the slop check. `syncMarkerRows` (lib/citation-rows.ts) gives
  every marker its citation row on every edit (it runs inside `returnToReviewAfterEdit`). publishCore and
  the hand-off publish refuse a body that still has a marker, override or not.
- **WordPress images** (ART-06): featured, OG and inline app images go to the media library
  (`uploadImageToWp`, `rewriteInlineImages`); the SEO plugin only ever gets a PUBLIC og:image
  (`publishReport.ogImageUrl`), inline uploads are remembered per stored file (`Setting wp:media:<ws>:<key>`).
- **A draft hand-off isn't live** (ART-10): publishedUrl stays null (the draft link is `publishReport.draftLink`);
  Approve & publish / Publish now runs `publishWordPressDraftCore` — status set on the site, read back, and
  only `publish` makes it published. Publish labels hand-off rows. A refresh at final approval goes through
  publishCore (it used to fall through to a bare status flip).
- **No WordPress, no bare flip** (ART-12): the editor shows Download HTML + Mark as published; the live
  URL is required (`markPublishedManuallyAction`, `back=editor` returns to the article).

## ⚠ One set of network rules; the queue keeps its places (2026-10-27, audit Phase 2, social group)
- **Network rules live in `lib/social/validate.ts`** (`legProblem` / `postProblems` / `scheduleRefusal`): YouTube and a
  Facebook Reel need a VIDEO (`requiresVideo` — the app attaches images only, so the composer marks them "not available
  yet"); Instagram, TikTok, Pinterest, Snapchat and Stories need an image; TikTok needs a chosen audience; and each
  network's character limit. Every path that schedules asks `scheduleRefusal` — composer and edit saves (not drafts),
  the calendar drag, Queue, Queue all, bulk Queue, Approve (approves but keeps it a draft, saying why), the assistant's
  queue/schedule, and full autonomy's auto-queue (skips it; reads 100 drafts, queues up to 10). The SEND checks each leg
  on its TAGGED text: a refused leg fails with its reason and the rest go; with nothing left Zernio isn't called, not even
  to upload images. Drafts are exempt everywhere (SOC-19).
- **An unreadable image stops the send** (SOC-09): `makeUploader` throws on a failed storage read, so every leg fails
  naming the file, and Retry works. It used to post text-only and mark the legs posted.
- **The assistant's draft_social_post writes Zernio's account id** and the account name (SOC-07), not our row id.
- **Webhook** (SOC-15): only post.published / post.failed / post.partial change anything. A partial is settled leg by leg
  from `GET /posts/{id}` (`settleLegsFromZernio`), and a posted leg is never moved back. A workspace can set its own
  `zernio:webhook_secret` (Settings → Connections, beside its own key); a delivery verified by it touches only that
  workspace. The route answers 503 only when there is no secret anywhere.
- **Slots are claimed, not read** (SOC-16): `claimFree` reserves the workspace-minute (Redis `SET NX`, 3 min; a process
  map without Redis). Queue, Queue all, bulk, autonomy and evergreen all go through it, looking through 2000 slot instants.
- **`SocialPost.timeChosen`** (migration `20261028100000_social_post_time_chosen`): true when a person picked the moment
  (schedule, optimal, the drag, a dated CSV row, Caption Studio's dated captions), false when the queue placed it.
  Removing a slot or changing the posting timezone moves only `timeChosen: false` posts. A new zone re-anchors them to the
  same local time (the checkbox is on by default; one whose new time has passed goes back to drafts). A removed slot sends
  them back to Approvals only when `require_approval` is on, otherwise to drafts. Older rows default to false, so they are
  treated as queue-placed, which is how everything was treated before.
- **Editing keeps per-network fields** (SOC-18): a network with its own first comment or images opens customized, so its
  fields are submitted; "Use base" clears that network's own images (`perNetworkMarks` + `custom_<P>`). A stored Reel stays
  selectable in the dropdown — a disabled option isn't submitted, and a save would have made it a feed post.
- **Sent posts are the record** (SOC-20): deleting goes through the registry kind `socialPost` (DeleteButton confirmation,
  audited) and only for `DELETABLE_POST_STATUSES` (draft, scheduled, failed); `deleteSocialPostAction` is gone.
  `/social/[id]` is the read-only post page: each network's status, link and error, with Retry failed and Duplicate.
  The editor redirects sent posts there, and Sent rows have Retry on failed and partial posts.

## ⚠ Every link goes somewhere this person can open (2026-10-27, audit Phase 2, shell and assistant group)
- **`lib/role-links.ts` is the map of role-gated pages** (`roleNeededFor` / `canFollow` / `whoCanFix`): ADMIN = `/admin/*`
  and `/setup/people`; EDITOR = the social pages (compose, calendar, approvals, engage, performance, a post's edit page),
  `/assistant*`, `onboarding/channel/new`; everything else is any member. ⚠ It MIRRORS the page gates — a page that changes
  its `requireRole` must change here too. Surfaces that link across roles ask it and, when the answer is no, say who can
  act (`components/RoleLink.tsx`, or plain text) instead of a button that bounces to /forbidden: the Inbox's condition
  cards and pipeline strip, Settings (no People tab or card link for non-admins; Connections rows), Distribute, Help and
  the owner's guide, and the stage strip, which drops tabs the role can't open (Compose, Calendar… for a viewer).
- **"N things need you" counts only what this person can act on** (`getInboxData(…, { admin, editor })`): post approvals
  and invitations are an admin's, article work an editor's; a viewer's is zero. A condition only an admin can fix doesn't
  make the header say something needs you.
- **The assistant is for editors and admins** (ENG-17): viewers get no rail entry, Ask button or dock; `/assistant` tells
  them why; `/api/assistant` answers a viewer with a JSON 403 (it used to redirect, and the dock parsed /forbidden as JSON).
- **The dock's conversation is per workspace AND person** (ENG-18): localStorage `mys.assistant.thread:<ws>:<user>` (the old
  unscoped key is removed on load), the dock is keyed by workspace so a switch remounts it, and a send to a conversation
  that's gone starts a new one with that message.
- **Header pollers read the ACTIVE workspace** (ENG-19): `activeWorkspaceIdFor(userId)` in `lib/acl.ts` (the cookie, else
  the first membership — `requireMembership`'s choice) for `/api/ticker` and `/api/ai-activity`; EngineStatus is keyed by
  workspace.
- **An article that passes every check at review has "Move to final approval"** on its Inbox card (SHL-06, editors,
  `advanceBlogStatusAction` with its own server-side gate). Without full autonomy nothing moves it on by itself, and the
  card says so; under full autonomy it neither counts in the Inbox nor turns the Drafts badge red.
- **Elsie** (SHL-08): steps anchor only on real elements — `npm run check:guide` (`scripts/check-guide-anchors.mts`) fails
  when an anchor exists nowhere or a route/link is missing or redirect-only; run it after renaming a rail entry or moving
  a page. `stepVisible` skips setup steps for non-admins, rail anchors not on THIS person's rail (Settings, Channels and
  Brand are admin-only), routes/links their role can't open, and studio steps while the studio is off. A route that
  redirects no longer strands her: she navigates once and then looks on the page she landed on. Her keys (arrows, Escape)
  are live only while her popup is on screen.
- **A member of nothing can always sign out** (SHL-11) — the operator's "Create your workspace" form too.

## ⚠ Ideas get made, and Intel's numbers are real and dated (2026-10-27, audit Phase 2, ideas group)
- **Every "Discover" goes through `discoverIdeasAction`** (IDE-03): Articles' buttons (`discoverBlogIdeasAction`) delegate
  to it with `formats=article, back=/blog` — per Topic, the manual ceiling, the person recorded. Don't call
  `discoverIdeasCore` from a button again (six untagged ideas a press, recorded as the sweep).
- **Approved ideas say what's holding them** (IDE-05): `lib/idea-blockers.ts` `draftingBlockers` names why the engine
  won't draft approved articles or social posts by itself (AUTOPILOT off, paused, the function's mode manual, the daily
  budget, the weekly cap, `social:autogen` off, the rotation rollback, no text-capable account). It MIRRORS the sweep's
  checks in `blog-autopilot.ts` and `social/drafting.ts` — keep them in step. The board shows "Approved, but not being made"
  and no longer promises the engine will make them.
- **Social ideas have Draft now** (`draftSocialIdeaNowAction` → `draftSocialIdeaNow`): the sweep's own writer
  (`writePostFromIdea`), without the autogen switch or the weekly quota (a person asked); it saves a DRAFT for them (no
  slot), `createdById` set, approval pending unless an admin pressed it. The idea is claimed in the write (conditional
  update after the post exists; the loser's post is deleted). A person's draft counts toward the weekly quota (volume),
  not the daily budget (`actorId` set).
- **Intel re-reads what it measures** (IDE-11): `lib/intel-index.ts` `indexIntelChannel` (moved out of the "use server"
  file — exports there are browser-callable) refreshes channel counts and every video's views/likes/comments/ratios with
  `IntelVideo.measuredAt` (migration `20261028110000_intel_measured_api_cache`). The channel page has "Re-read from
  YouTube" (`reindexIntelChannelAction`, ~4 units). "Outlier videos" is published in the last 30 days.
- **Unmeasured is a dash** (IDE-12): `formatNum(null)` is "—" everywhere; uploads/week is computed from upload dates at
  index ((n−1)/span); velocity was never computed — its filter, "Hot new channels" and the stat box are gone (the
  `velocity:` search token is ignored); comments are read (`commentCount`).
- **YouTube quota** (IDE-13): every Intel action that calls YouTube is EDITOR+, the competitor search is editors-only;
  `ytGet` meters each call into `UsageLog` (`action: "youtube.api"`, `tokens` = units: search 100, else 1), shown on
  Settings → Usage; `searchChannels` is cached per workspace and query for 24 h in `ApiCache`.

## ⚠ Models that can write, limits that hold, keys that stay (2026-10-28, audit Phase 2, settings group)
- **The router resolves every call's model** (SET-01): `llm.complete` / `llm.stream` run `resolveUsableModel` first,
  so a stored choice whose provider isn't wired or keyed (GPT, DeepSeek, Grok, Kimi, MiniMax, a keyless Claude, the
  mock) writes with the first reachable model instead of the mock. The reply's `model` is the one that ran. A BLANK
  model means inherit: the workspace's `defaultModel`, then `DEFAULT_LLM_MODEL` — the studio's chains end in `""` (they
  ended in `"claude-sonnet"`, so a channel on "Workspace default" never got it). Don't add `?? "claude-sonnet"` back.
- **Pickers offer only what can run**: `PICKABLE_MODELS` (lib/llm/models.ts — Anthropic and Google, no mock, no
  legacy alias) through `modelChoices()` with key status, rendered by `components/ModelOptions.tsx` (keyless options
  disabled; a choice stored before this stays listed and selectable, marked, with `ModelChoiceNote` saying what
  writes instead). Every save path calls `modelChoiceProblem(next, ws, current)` — an unchanged stored value passes, so
  an unrelated save never fails or silently changes it. The four pickers: workspace, channel, article, script.
  Wiring another provider = add it to `TEXT_PROVIDERS` + `getProvider` + `PROVIDER_LABEL`.
- **Soft limits are enforced where things are made** (SET-02): `lib/soft-limits.ts` `softLimitProblem(kind, ws, user)`
  — scripts (every `db.script.create` a person triggers, the API answers 429, the assistant's tools refuse),
  thumbnail sets (`thumbnail.brainstorm`/`thumbnail.clone` UsageLog rows), Agent Mode runs (`agent.run` row written
  at launch), channels (the workspace's). Per person, per UTC calendar month; the engine (no person) is held by the
  daily AI budget instead. A new creation path must ask it first.
- **Every AI call is metered** (`lib/usage-meter.ts` `meterAi`, from the two routers): `UsageLog` `ai.text` / `ai.image`
  with `provider`, `model`, `inputTokens`, `outputTokens` (migration `20261028120000_usage_provider_tokens`, plus the
  `[workspaceId, action, createdAt]` index). Mock replies are rows too (provider `mock`) — Usage names them as
  placeholders. Usage shows per provider/model, articles/social/images, and each limit against the busiest PERSON
  (it compared workspace totals with per-person caps); it links to Limits. No dollar figures — no price table is kept.
- **Save never clears a key** (SET-05): `saveApiKeyAction` / `saveSearchKeyAction` refuse an empty field; Remove key
  (`intent=remove`) only asks (`?confirmRemove=<id>`), `intent=remove-confirmed` clears. Works without JavaScript.

## ⚠ The studio writes only what a model wrote, and stops when told (2026-10-28, audit Phase 2, video studio group)
- **Placeholders are refused before they're written** (VID-05): `lib/studio-ai.ts` `placeholderProblem(res, outcome)` —
  every studio action that stores model text (canvas outline/script/humanize/improve, builder steps, promo assets,
  research reports, cloned templates, thumbnail concepts) checks it and redirects with `flashErr`, writing nothing.
  Long calls pass `STUDIO_TIMEOUT_MS` (the router's 45 s default turned long scripts into mock text). Thumbnail
  concepts are checked BEFORE the four paid image renders.
- **Templates and brand reach the prompts** (VID-13): `templateBlock(template)` renders a template's sections, timing,
  beats and pacing (cloned templates' `ai` JSON or built-ins' `sections`), not just its name. Thumbnails add the
  channel's `thumbnailConfig` (palette, typography, face position, style notes) and honour its
  `limitThumbnailsPerMonth`.
- **The script editor saves what's on screen first** (VID-06): Humanize and Improve `flush()` before calling the
  server (Improve's offsets are into the SAVED body); the editor is keyed on the row's `updatedAt`, so a server
  rewrite remounts it on the new text; unsaved typing is flushed on hide/unmount; a failed save shows "not saved".
- **A cancel holds** (VID-07, VID-09): the agent job claims `queued|running → running` conditionally, checks for a
  cancel after every model call BEFORE writing, and its finish/fail updates are conditional on `running` — a
  cancelled run is never overwritten. One run per script at a time. Renders: `cancelRenderAction` (queued or
  rendering → failed, "Cancelled by …"); `processRenderCore` re-checks `rendering` before each scene and its done/failed
  writes are conditional. `components/AutoRefresh.tsx` refreshes /videos and the storyboard while anything renders.
- **Veo lengths are 4, 6 or 8 s** (VID-11): `snapSceneSeconds` (lib/captions.ts) snaps on READ in `parseScenes`, the
  scene editor is a 4/6/8 select, and the length is SENT (`durationSeconds`) — it never was, so clips, SRT and cost
  disagreed. Packaging (VID-12) takes published posts with NO render, newest first, and moves past a failure.
- **No invented production numbers** (VID-08): "Sync stats now" wrote views/retention from a hash of the project id
  — it now refuses (a project isn't linked to its YouTube video); the project page shows none; onboarding ignores
  ChannelStat rows without a real 11-character video id (every existing row is one of those inventions). Chapters
  are COMPUTED from the script's headings at 150 wpm (`chaptersFromScript`). CTR scoring sends the rendered image to
  a vision model (`askAboutImage`); no image, no vision key or no number = no score (it stored 50).
- **Builder section regenerate splices** (VID-15) into the CURRENT body by the section's heading, sending that
  section's text; a heading changed on the Canvas is refused. Clone-from-URL (VID-14) reads a `watch?v=` /
  `youtu.be` / `shorts` link as THAT video and refuses with no transcript.
- **Task board** (VID-16): keyed on the tasks it's given (server changes show), a failed move rolls back
  (`moveTaskAction` returns `{ ok }`); `closeStaleAutoTasks` (lib/auto-tasks.ts, run by the cycle and the Tasks
  page) closes Review/Images/Render-failed auto-tasks the pipeline has moved past, matched by the link in their
  description. Teleprompter (VID-17): fixed-height `h-dvh` root + `min-h-0` scroller; stops at the end.

## ⚠ Reports say only what was measured; a refusing provider is named (2026-10-28, audit Phase 3, part 1)
- **`postPerformance` lists PUBLISHED posts unless told otherwise** (MEA-01, MEA-09, SHL-04) — newest published first;
  pass `status: "any"` for every status. The opt-in filter was the documented trap: the client PDF said "Nothing
  published yet", Measure counted drafts as tracked posts, the Inbox's Results were all dashes.
- **Compliance is counted, not asserted** (MEA-02): `lib/report-facts.ts` `complianceFacts` / `overrideSentence` — how
  many published posts went out under an admin override (the `blog.gate_overridden` audit row; the post's own
  override fields clear on edit). Never print a fixed "100% passed" again. Search Console is stated from the
  config and the last sync (`searchConsoleLine`, MEA-03).
- **Unmeasured is null, everywhere a sum is shown** (MEA-04): `homeStats.clicksThisWeek` is `number | null`;
  `sumMeasured()` for tiles; Insights' search metrics are null when no snapshot carried them; weekly series are
  labelled by the week's start date (not W1…W8) and the PDF prints "not measured" for an unmeasured week.
- **Social follow-through is SocialIdea → SocialPost** (MEA-08): a published post counts when a social post made
  from it went out (`posted`/`partial`; old SocialVariant rows still count). The report's social table reads
  `SocialPostTarget` legs per network.
- **Read pages read for everyone** (MEA-10): Social performance is `requireMembership`; its actions and each card's
  buttons are editors' (`PostCard readOnly`). Don't put `requireRole` on a page that only shows things.
- **A provider refusing a workspace's calls reaches the Inbox** (found 2026-10-28: LSI's Google credits ran out and
  the engine went quiet for days): `lib/llm/provider-health.ts` — the router records 402/credits, 429/quota and
  401/403/bad-key refusals per workspace and provider (`llm:refusal:<provider>`, at most one write per 10 min), a
  success clears it, and `lib/home.ts` shows "<Provider> is refusing this workspace's AI calls". Timeouts aren't
  refusals.

## ⚠ Windows end where the data does; rates have honest bases (2026-10-28, audit Phase 3, part 2a)
- **Per-post figures are 28-day windows** (MEA-14): `postPerformance` gives the impression-weighted position
  (`weightedPosition`) of the 28 days ending at the post's latest reading, `prevPosition` for the 28 before, and
  `clicks` summed over the window (`WINDOW_DAYS`). Single-day positions made "biggest movers" the noisiest days.
  `homeStats.avgPosition` is the same weighting over the workspace's last 28 days.
- **Like with like** (MEA-11): `publishedLastMonth` counts the SAME elapsed days of last month; weekly series end
  at the last day that has data (Search Console lags ~2 days), not "now".
- **Bases** (MEA-15): no cadence change on a zero earlier half; social impressions are impressions (reach no longer
  stands in) and the rate pairs engagement with impressions per reading; best time counts POSTS, not network legs;
  pipeline velocity is the median over ideas whose post published in the window (refresh ideas excluded, also
  from the funnel); the budget block is `generationsToday` against `DAILY_AI_BUDGET`. `sumOrNull` drops undefined.
- **A typed reading is one named day** (MEA-17): the manual entry has a date (default yesterday) and is refused
  where Search Console or GA4 already recorded that day for the post.
- **Posting timezone, said** (MEA-20): `lib/zoned-dates.ts` — `zonedMonthStart`, `zonedDayStart`,
  `formatZonedMoment` ("28 Oct, 00:50 EDT"). Month boundaries and printed engine times use the workspace's
  posting timezone and name it.

## ⚠ The audit, Topics and recommendations tell the truth about time (2026-10-28, audit Phase 3, part 2b)
- **YouTube audit** (MEA-12): cached per window AND connected channel (`youtube:audit:<days>:<channel>`); connected
  but no access token = an error saying the sign-in was refused (it read "not connected"); a failure is cached 10
  minutes (`youtube:audit_error:…`) so views don't re-run ~10 calls; `AuditVideo.reportPending` marks uploads
  inside the ~2-day Analytics lag with no row (a dash, not 0).
- **Topics** (MEA-13): the out rate is ONE cohort — of what was made in the window, how much is out (it divided
  everything published in the window by what was made in it, passed 100%, and could auto-raise a Topic's
  priority); clamped to 100. Measure → Topics names each column's window (counts all time; clicks, views and
  engagement over the range; position latest).
- **Recommendations** (MEA-16): each sweep RESOLVES open findings whose rule didn't fire (or fired with a different
  fingerprint — a bucket change), except rules that threw; `openRecommendations` sorts warning → opportunity →
  info (it sorted the strings, info first). Status values: open | accepted | dismissed | applied | resolved.

## ⚠ Shell copy says what was checked (2026-10-28, audit Phase 3, part 3a)
- **Connections is resolved like the providers** (SET-04): search/voice/video/YouTube keys fall back to the platform
  and env as the providers do; Writing counts only Claude/Gemini keys and shows "partial" while a provider is
  refusing calls (`providerRefusals`); storage reads `getStorageBackendSetting()` and flags local disk; mailboxes
  count only `status: connected`; analytics uses `gscConfigured` / `ga4Configured` (service accounts count).
- **Automation speaks plainly** (SET-13): function labels, not `fn=mode` tokens; the last cycle is summarised from
  its CycleReport (`cycleSummary`) in the posting zone; every mode/target/SEO/pause change redirects with a
  confirmation; mode buttons carry `aria-pressed`.
- **`stop(name)`** (lib/sentence.ts) adds the full stop only when the name doesn't already end one (SET-14).
- **Words from the actual condition** (SHL-12): the Inbox says "Everything is paused" when it is (never "The engine is
  running" then) and doesn't promise a digest without a connected mailbox; `/forbidden` takes `?need=ADMIN|EDITOR`
  (requireRole) or `?why=operator|member` and says which.
- **The engine pill** (SHL-03) shows the time today, "yesterday HH:MM", else "N days ago"; the ticker and feed name
  auto-advance, social posts written/queued, social ideation, holds and failures.
- **Inbox counts are totals** (SHL-05): `InboxData.counts` per group (images and claims filtered BEFORE the list is
  cut, with one query each for their audit records); groups show "Showing N of M".

## ⚠ Help, dates, outliers and the assistant stay current (2026-10-28, audit Phase 3, parts 3b and 4)
- **Help reads the navigation** (SHL-14): the guide's stage tabs come from `STAGES[...].tabs(...)` (`tabsOf`); when a
  page moves, fix Help's quick starts, shortcuts and the FAQ in lib/help.ts too — old paths there (Blog → Automation,
  Social → Workflow, Topics in Brand, a Review stage) were wrong for weeks.
- **One day format** (SHL-15): `formatDay(date, tz?)` → "28 Oct 2026"; moments via `formatZonedMoment` in the
  posting timezone. Don't print `toISOString().slice(...)` or a bare `toLocaleString()` to a person.
- **Outliers** (IDE-09, IDE-10): `OUTLIER_MIN_VIEWS` (1,000) — the indexer stores no score under it, averages Shorts
  and long-form separately and needs 3 of a format; lists filter on views; `outlierBand(null)` is "not scored".
  Research matches every indexed outlier per Topic and shows each group's true count.
- **Social copy** (SOC-27): Approvals says whether new posts queue (auto-queue) or wait; Engage's unread list is
  "Not marked seen yet"; Distribute's queue count is a count query, not the 10 listed.
- **Assistant** (ENG-30): its example prompts are swapped for this workspace's held article, approved idea and
  Topic (`examplesFor`); keep every example backed by a tool that does it; the app map names social ideas,
  Topics and today's Distribute and Measure tabs.

## ⚠ Speed: no server code in the browser, quiet pollers, warm pages (2026-10-28, audit Phase 4, part a)
- **The platform list is `lib/zernio/platforms.ts`, import-free** (PRF-03): `lib/social/networks` (used by the composer,
  calendar and editor) imported it from `lib/zernio`, which pulls in `node:crypto` and the settings/database layer —
  every such page shipped a ~500 KB crypto polyfill, twice. A client component must never import `lib/zernio` (or
  anything that reaches `node:*`); "use server" action files are fine — the browser gets references, not code.
  After the change no chunk in `.next/static/chunks` contains pbkdf2.
- **Header pollers back off** (ENG-29): AiActivity polls every 5 s while something runs or right after a click or
  submit, otherwise the gap doubles to a minute; one chain at a time (a run number); nothing while the tab is hidden.
  EngineStatus skips its minute while hidden.
- **Per-request and short caches** (SHL-20): `getCurrentUser` is React `cache()` — once per render (server actions
  run outside the render scope and read fresh); `stripCounts` is cached 10 s per workspace in-process, so a badge
  can lag a click or two.
- **Routes are warmed at boot** (PRF-01): `instrumentation.ts` requests `WARM_ROUTES` once, signed out, 5 s after a
  production start, and logs `[warm] N of 31 routes answered`. Add a page there when it becomes a common landing.

## ⚠ Heavy pages: Engage keeps its lists, the board drops its panels (2026-10-28, audit Phase 4, part b)
- **Engage's three lists are kept between visits** (SOC-26, `lib/zernio/inbox-cache.ts`): conversations, posts with
  comments, and reviews live in `ApiCache` (`zernio:inbox:<ws>:<list>:<net|all>`, one-day expiry). Under two minutes
  old → served as is; older or marked stale → served at once and re-read in `after()`; no copy or `?fresh=1` (Refresh
  now) → read before rendering. A failed read keeps the copy and the page names the failure. The open thread (messages
  or comments) is always read live. `markInboxStale(ws)` runs after a DM reply, a review reply, a comment, a comment
  delete and every inbox webhook delivery — a new write path into the Zernio inbox must call it too. Freshness lives in
  the JSON (`readAt`, `stale`), never in `expiresAt`: other ApiCache writers purge expired rows.
- **An article idea's tags and merge are on `/ideas/article/[id]`** (IDE-20, editors; role-links lists it): every
  board card carried that form plus a list of every other open idea and 60 site pages. The card links there; the
  actions take `back=edit` and redirect with a flash (the board's inline use had none).
- **The board reads open ideas apart from closed ones** (IDE-20): up to 200 discovered/approved per table, priority
  (or outlier score) `nulls: "last"`, plus the 60 most recently changed closed ones. Header counts still come from
  `groupBy` over everything. Postgres sorts NULL FIRST under DESC — always say `nulls: "last"` on a nullable rank.
- **Performance pages its history** (PRF-02): 25 a page (`?page=`), total from a count query.

## ⚠ Lint is clean — keep it so (2026-10-28, audit Phase 4, part c)
- **`npx eslint .` reports no errors** (PRF-04; it was 59 — 48 at the audit). Run it with tsc before a commit.
- **Apostrophes in JSX text are `&apos;`** (react/no-unescaped-entities) — the usual way the count grows back.
- **"Now" in a server render comes from `lib/request-time.ts`** (`requestNow`, `daysAgo`): reading the clock once per
  request is right on the server, but the React Compiler's purity rule can't tell a server component from a
  client one. Client components keep the clock in state (SocialCalendar's `useMinuteClock`) and check "has it
  passed" in the handler (`hasPassed`).
- **No components created inside a component** (react-hooks/static-components): the editor's toolbar `Tool`, the
  Inbox's `FollowLink`, RSS's `ModeSelect`, Analytics' `Status` / `CredLine` are module-level. A component made
  during render is a new type each render, so React remounts it.
- **Refs are written in `useLayoutEffect`, not during render** (BlogBodyEditor's `latest`, RichTextEditor's
  `handlersRef`); the editor's seed is `useState(html)`. Elsie stores the popup's measured height with its
  position. SocialCalendar's mount flag is `useSyncExternalStore` (false for the server render and hydration).
- **Deliberate exceptions say why, in place**: Elsie's two layout steps and PostingSchedule's browser-only zone
  read keep `setState` in an effect; post-card images stay `<img>` (stored files are session-gated, and
  next/image's optimiser fetches without the session). `_name` bindings are allowed by the lint config.

## ⚠ The engine checks in; buttons say what happened (2026-10-28, audit Phase 5, wave 1, part a)
- **Every cycle that runs writes a check-in** (E-ENG-03, `lib/engine-heartbeat.ts`, WorkspaceSetting
  `autopilot:heartbeat`): idle, paused or busy — so "nothing to do" and "not running" differ. `runAutopilotCycle`
  writes it after the lock. The header pill turns red with "No check-in since …" after two hours (`SILENCE_MS`), its
  panel and Automation show the last check-in, and the Inbox warns (not while paused or with AUTOPILOT=off). The
  words live in import-free `lib/heartbeat-note.ts` because the pill is a client component.
- **Today's AI allowance is visible** (E-ENG-06): Automation shows "N of 20 unattended runs, resets at midnight
  <zone>"; the Inbox says when it's used. Only unattended work counts (`generationsToday`).
- **"Approved, but not being made" links to the dial** (E-IDE-05): `draftingBlockers` returns `{ text, href? }`.
- **Quick additions report back** (E-ART-19): Add FAQ, Add key takeaways, Suggest internal links and Link it
  redirect to `?tab=optimize` with `flash`/`flashErr` — already there, paused, protected, no site pages, the AI gave a
  placeholder (`placeholderProblem`), nothing usable, or what was added. A placeholder no longer wipes saved link
  suggestions.

## ⚠ Outliers show their base; Research rows and the header are quieter (2026-10-28, audit Phase 5, wave 1, part b)
- **One outlier chip** (E-IDE-11, `components/OutlierChip.tsx`): the multiple, its band when asked, and the views it
  rests on where the row doesn't show them (video idea cards read their seed's views — the board includes
  `sourceVideo.views`). No score reads "not scored": Intel printed a missing score as "0.0x" and four places as a
  bare "x". Don't format `outlierScore` by hand again.
- **Research rows: one "Make it an idea" button** (E-IDE-12): `ResearchIdeaForm compact` is a `<details>` with the
  format and Topic inside (it opens without JavaScript); the video page keeps the full form.
- **The header is calmer** (E-SHL-04): role, email, settings and Sign out are behind the avatar
  (`components/AccountMenu.tsx`, closes on navigation, click-away and Escape); "+ Channel" shows only to editors
  whose studio shows (`studioState().show`).

## ⚠ One date style; the sync names what it couldn't match (2026-10-28, audit Phase 5, wave 1, part c)
- **Dates go through `lib/zoned-dates.ts`** (E-SHL-16): `formatZonedMoment(at, tz)` for a moment ("28 Oct, 09:46 EDT")
  in the posting zone, `formatDay` / `formatShortDay` for a date (UTC unless a zone is given — a stored date-only value
  never moves a day). Raw `toISOString().slice(...)`, zone-less `toLocaleString` and en-US dates were swept from the
  assistant, audit, experts, the editor's comments and versions, brand, Drafts, scripts, YouTube, Keywords, Settings,
  production pages, the report's feed, the Analytics tab and the Inbox's cards. `zoneLabel` takes the first locale
  with a real abbreviation (en-GB alone printed New York as "GMT-4").
- **Unmatched pages are kept** (E-MEA-10, `analytics:unmatched`): each sync that read anything stores the 15 busiest
  pages that matched no post (URL variants added, Search Console's full address kept). The Analytics tab lists them
  with their traffic; a full address can be linked to a PUBLISHED article with NO live URL
  (`linkUnmatchedPageAction`, ADMIN, audited) — an existing URL is never replaced, and a GA4-only path can't be linked.

## ⚠ Connecting checks it's the right site (2026-10-28, audit Phase 5, wave 1, part d)
- **Site checks at connect** (E-MEA-11, `lib/analytics/site-check.ts`): Google's verify only proves access, so a
  property of another website verifies fine and then reports its traffic (CF's wrong GA4 property). Saving Search
  Console compares the site with this workspace's website; saving GA4 reads the property's web streams (Analytics
  Admin API) and compares those. The website is INFERRED — the WordPress connection, else the host most published
  articles live on, else site pages — so a mismatch is a warning on the tab, never a refusal; no evidence, or an
  unreadable Admin API, means no warning rather than a guess.
- **YouTube says what was connected**: the connect message names the channel's public video count, and says plainly
  when it's zero (LSI connected an empty channel). `youtubeConnectedMessage` in lib/youtube/oauth.ts.

## ⚠ The kill switch is visible; the board can be searched (2026-10-28, audit Phase 5, wave 2, part a)
- **The pause shows on every page** (E-ENG-14): a red line under the header in `(app)/layout.tsx` while
  `isGloballyPaused` — admins get "Resume on Automation", others are told an admin can.
- **Unschedule all social posts** (E-ENG-14, `unscheduleAllSocialAction`, ADMIN, asks first via
  `?confirmUnschedule=1`, audited `social.unscheduled_all`): scheduled → draft, KEEPING `scheduledAt` — a dated
  draft is never auto-queued, even under full autonomy, and Queue all restores it at its time while still ahead.
  Posts already `publishing` are left alone; articles aren't touched (the confirmation says how to hold them). This
  is not the SOC-04 hold state — that still waits on the owner.
- **Board search, Topic filter and order** (E-IDE-02): `/ideas?q=&topic=<id|none>&sort=priority|newest|source`,
  applied in the queries (`loadIdeasBoard`); a Topic shows only its lane, a search hides lanes it emptied, header
  counts stay whole-board. The per-Topic page links to its lane. E-ART-01 (safe editing) shipped as ART-01/03.

## ⚠ Triage many at once; approvals scale and talk (2026-10-28, audit Phase 5, wave 2, part b)
- **Bulk triage on the board** (E-IDE-01, `actions/ideas-bulk.ts` `bulkIdeasAction`, editors): each selectable card has
  `<input name="sel" value="<format>:<id>" form="idea-bulk">` — the toolbar (`components/IdeaTriage.tsx`) is that form, so the
  cards stay server-rendered and their own forms untouched. Approve / Reject / Tag (or "no Topic") / Delete (asks first;
  the server wants `confirm=yes`). Each table keeps its OWN open states (`RULES`, mirrored by the page's `canSelect`): a drafted
  or merged article, a scripting video, a drafted social idea is never selectable or moved; approvals and rejections are
  audited per idea with `bulk: true`, a delete once as `ideas.bulk_deleted`. It returns to the same view (`back`, held to /ideas).
  Keys (never while typing): j/k move between visible cards (`data-idea-card`), x ticks, a/r press the card's own
  `data-key` button, ? lists them. A lane has "Select all N open" (`data-lane-toggle`).
- **Approvals scale** (E-SOC-02): `approvePost` / `requestChanges` in `actions/social-workflow.ts` are the ONE path for the
  card buttons, "For a time…" and `bulkReviewSocialAction` (ADMIN; pending posts tick into `components/ApprovalBar.tsx`).
  Both claim the decision in a conditional update, so a second reviewer changes nothing; the bulk path decides PENDING
  posts only (`from`), so a stale tick can't approve one a reviewer just sent back. A reviewer's time (`at`, read in
  the posting zone) must be ahead and wins over the requested time and the queue (`timeChosen: true`, kept even when a
  network rule leaves it a draft). A bulk send-back needs a note; it goes to each author.
- **Each post has a review thread** (`SocialPostComment`, migration `20261028130000_social_post_comments`): Request changes
  writes its note there (`kind: "changes"`) as well as `reviewNote`; `addSocialPostCommentAction` (editors) notifies whoever is
  on the thread, else the admins. Shown on Approvals and the post's edit page (`PostThread`, `lib/social/post-comments.ts`).
  No edit or delete — it's the review record. The assistant's own approve tool (lib/assistant/tools.ts) is separate.

## ⚠ The queue can be rearranged; the calendar shows everything (2026-10-28, audit Phase 5, wave 2, part c)
- **Queue tools** (E-SOC-05, `bulkPostsAction` ops `shift` / `moveto` / `reslot` / `shuffle` in `actions/social-lists.ts`, editors):
  only `status: "scheduled"` posts move (never one `publishing`), only to a moment over a minute ahead, each update
  conditional on the post still being scheduled. Shift and Move-to-day keep each post's WALL-CLOCK time in the posting
  zone (`zonedParts` → `zonedTimeToUtc`, so 09:00 survives a clock change) and mark it `timeChosen: true`; Re-slot puts
  them in the earliest free slots in their current order (`claimNextFreeSlot`, `timeChosen: false`); Shuffle reorders
  the same times (each time keeps its own `timeChosen`). `swapQueuedPostsAction` (the rows' earlier/later buttons)
  swaps two posts' times in one transaction, conditional on both still holding the times the page showed. All
  audited `social.queue_rearranged`.
- **The calendar shows everything** (E-SOC-12): `CalendarPost.kind` is scheduled | proposed (a draft with a time) |
  held (pending or changes — dashed amber, not draggable, links to Approvals) | draft (the tray). Pending posts are read
  for the calendar only; the page's Drafts list still leaves them to Approvals. Filters (network, category,
  campaign, "show proposed and held") are client-side and mirrored in the URL (`net`, `cat`, `camp`, `ghosts=0`).
  Ticked chips move together: drag one and the rest shift by the same days (a day drop) or the same delta (an
  exact drop), one server call each; a refused one goes back. ⚠ Keep the filter a module-level function and the
  derived lists in `useMemo` — the React Compiler lint refuses memos built on a closure.

## ⚠ One range for Measure; one shell poll; links are checked at build (2026-10-28, audit Phase 5, wave 2, part d)
- **One date range** (E-MEA-01, `lib/measure-range.ts`, `components/RangePicker.tsx`, `actions/measure.ts`): presets 7/28/90/365,
  custom whole days in the posting zone (both ends included, at most 730), and `compare=1`. URL first (`range`, `from`,
  `to`, `compare`), then the cookie `mys.measure_range` the picker sets (so tabs keep it without their links carrying it),
  then 90 days. On Measure, Insights (each ranged figure gets its previous-period line; cadence and WIP say they read
  now), Topics, Social performance and the YouTube audit (nearest of its windows, said). `MetricsRange` has an
  optional `until`, and every collector filters through `within(range)` — a new collector must too, or a custom range
  and the previous period silently run to now. Reports keep their own per-report ranges.
- **One shell poll** (E-SHL-01): `/api/shell` (and `/api/ticker`, its old name) returns the engine pill's events and
  state, the unread count and the strip's badges for the ACTIVE workspace; `components/ShellPoll.tsx` publishes the
  layout's values, then polls every minute while visible, into `lib/shell-live.ts` (import-free) — EngineStatus,
  `UnreadBell` and StageStrip read it with `useSyncExternalStore`. An answer for another workspace is ignored. AiActivity
  keeps its own seconds-long poll. Elsie's count still comes with the layout.
- **Links are checked at build** (E-SHL-02, `scripts/check-routes.mts`, `npm run check:routes`, run by `prebuild` with
  check:guide — so Railway's build fails on a broken link): every rail entry, stage tab, Help and Inbox link and Elsie step
  must land on a page that isn't redirect-only, and `roleNeededFor` must equal the page's gate (its own requireRole or
  a layout's; comments are ignored). A page that turns a role away with a message instead says `// gate: EDITOR` (the
  assistant does).

## ⚠ The Inbox can be snoozed and shared out (2026-10-28, audit Phase 5, wave 2, part e1)
- **Snooze** (E-SHL-03, `InboxSnooze`, migration `20261028140000_inbox_snooze_assign`): a day, three days or a week, this
  person's Inbox only. A snoozed item leaves the lists AND the true counts (so the header stops counting it) and is
  listed under "Snoozed" with Bring it back. **Assign to me** (`InboxAssignment`, one person per item, everyone sees it;
  anyone can take it over, only the holder lets go). Actions in `actions/inbox.ts` (editors); item keys from
  `inboxKey` in `lib/inbox.ts` — `post:` `article:` `image:` `citation:` `invite:`. Pass `userId` to `getInboxData` for
  snoozes to apply (the assistant's calls don't).
- **One card per article**: a held article's open questions fold into its card; the question cards are for articles
  that aren't held. **Waiting on an admin**: for anyone but an admin, post approval sits at the bottom under that
  heading. A cut list links to its full page where there is one ("see all").
- **The route check depends on nothing but the tree**: routes are matched most-specific first, as Next.js does —
  first-match in directory order passed on Windows and failed both Railway builds of part d (Linux readdir order
  resolved /social/approvals to /social/[id]). `CHECK_ROUTES_REVERSE=1` walks backwards to prove it.

## ⚠ The assistant's proposals are cards with a bound Yes (2026-10-28, audit Phase 5, wave 2, part e2)
- **Server-built confirm cards** (E-ENG-01, `lib/assistant/preview.ts` `buildPreview`, `components/ConfirmCard.tsx`): a
  proposal's card shows the tool, the post's real text, networks and time in the posting zone (from `postId`), the
  article, its state and live URL and its featured image (from `articleId`), a parsed `at`, and the other arguments —
  built from the database, never from the model's description. The `confirm` step carries `nonce`, `preview` and
  `expiresAt` (15 minutes); the dock and the thread page draw the same card.
- **A Yes is bound to its proposal**: the card's Yes sends `confirm: <nonce>` (dock → `/api/assistant`, thread page → a
  hidden field); a nonce for another card runs nothing and keeps the waiting proposal; a nonce with nothing waiting is
  told so — both answered in code, not by the model. A typed bare yes still answers the waiting proposal.
- **Checked again before running**: on yes the preview is rebuilt (and the role re-checked); a post or article gone,
  a post already sent, or a time now past means `not run: …`. A proposal whose preview already has a problem isn't
  made (`not proposed: …`). New tool arguments a card should show: name them `postId` / `articleId` / `at` / `text`.

## ⚠ Articles have a real publishing calendar (2026-10-28, audit Phase 5, wave 2, part e3)
- **`/blog/calendar`** (E-ART-07, Publish → Blog calendar, `components/ArticleCalendar.tsx`): a month (`?month=YYYY-MM`) laid
  out on the SERVER in the posting timezone — published articles at their time, scheduled ones, each week's publish day
  (`autopilot:publish_day`) — with articles at final approval and no time underneath. Every scheduled or waiting article
  names what would stop it publishing: `blockingChecks`, and "no website connected" (with a banner) when there's no
  WordPress. Admins drag one to a day, use its date field, or ✕ it off.
- **`rescheduleArticleAction(id, day | null)`** (`actions/article-calendar.ts`, ADMIN, final approval only — setting the time
  is the approval to publish): the browser sends a posting-zone DAY; the server keeps the article's time of day there
  (09:00 when it had none), refuses a day that has passed, audits `blog.scheduled` / `blog.unscheduled` (`via: calendar`)
  and notifies like the editor's Schedule.

## ⚠ Who did what is visible; admins hear about security changes (2026-10-28, audit Phase 5, security part 1)
- **Audit log** (E-SEC-05, Settings → Audit log, `/admin/audit-log`, `lib/audit-log.ts`): filter by person (or "the engine" =
  `actorId: null`), action prefix, entity type and whole posting-zone days; a person's activity summary; CSV of the same
  view at `/admin/audit-log/export` (≤10,000 rows; ⚠ a route handler isn't covered by the admin layout, so it calls
  `requireRole("ADMIN")` itself; `csvCell` defuses a leading = + - @).
- **Security notices** (E-SEC-12, `lib/security-notices.ts`, notification kind `security`, admins only, emailed by default):
  sent FROM `writeAudit`, so every path that records `membership.role_changed`, `membership.added`/`invited` as ADMIN,
  `membership.entered`, `api_key.saved`/`removed` or `integration.adopted` tells every other admin. A new security-relevant
  action needs its audit row and a line in `securityTitle`. Key saves are now audited at all — name and a 10-hex sha256
  fingerprint, never the key; People invitations are audited like the assistant's.
- **Editing banner and stale-tab guard** (E-SEC-13): admin pages say "Editing <workspace>" with its id. Server actions
  write to the ACTIVE workspace (cookie), so when the shell poll answers for another workspace (a switch in a second tab)
  `publishStale` fires and `components/WorkspaceGuard.tsx` covers the page until reload — on every app page, not only
  admin ones. (Forms don't carry the workspace id; the guard is the protection.)
- **Roles** (E-SEC-17, Settings → Roles, `/setup/roles`, any member): a capability table and the role-gated pages from
  `ROLE_PAGES` in `lib/role-links.ts` — keep the table's claims true when a gate changes.

## ⚠ Rate limits and security headers (2026-10-29, audit Phase 5, security part 2)
- **Rate limits** (E-SEC-10, `lib/rate-limit.ts` `hit(name, id)` → `{ ok, retryAfter }`; fixed windows in Redis, in-process
  without it; never throws): sign-in 30/min per address and 10/min per account (a limited try fails like a wrong
  password, in `authorize`), sign-up 10/min per address, reset requests 10/min per address and 3 per 15 min per account
  (same "check your email" screen either way), reset/verify tokens 20/min per address, verification resends 3 per
  15 min, webhooks `RATE_LIMIT_PER_MINUTE`×5 per address (429 + Retry-After before any secret is checked), `/api/v1`
  `RATE_LIMIT_PER_MINUTE` per person. The address is the first `x-forwarded-for` hop (Railway's proxy). A new public
  or auth endpoint should take a limit too.
- **Security headers on every response** (E-SEC-02, `next.config.ts` `headers()`): CSP `object-src 'none'; base-uri 'self';
  frame-ancestors 'self'`, X-Frame-Options SAMEORIGIN, nosniff, strict-origin-when-cross-origin, Permissions-Policy with
  camera/microphone/geolocation/payment off. ⚠ script/style/connect are deliberately NOT restricted — Next's inline
  scripts need a per-request nonce (every page dynamic); that strict CSP is its own step. Stored files keep their own
  sandbox CSP on top. Every raw-HTML render is a sanitised body or a fixed string; the brand colour is hex-checked.
- **Safe fetching** (E-SEC-01): the video assembler's clip download goes through `safeFetch` too; the remaining raw
  fetches are provider-returned outputs (Veo) or fixed Google endpoints.

## ⚠ API tokens, key history, idle members (2026-10-29, audit Phase 5, security part 3)
- **`/api/v1` takes a workspace token** (E-SEC-16, `ApiToken`, migration `20261029090000_api_tokens`, Settings → API tokens,
  `/admin/api-tokens`, ADMIN): `Authorization: Bearer mys_…`, read or read-and-write; only the sha256 is stored and the token is
  shown once, in the form's answer. Every v1 route asks `apiCaller(req, "read" | "write")` (`lib/api-auth.ts`) — a token acts
  as the admin who made it, a revoked one is a 401 at once, a read token writing is a 403, `lastUsedAt` is written at most
  once a minute; a signed-in session still works (write needs an editor). Made and revoked tokens are audited and tell the
  other admins (`securityTitle`). A new v1 route must go through `apiCaller`, never `auth()` alone.
- **Each key shows its history** (E-SEC-03, `lib/key-history.ts` from the `api_key.saved`/`removed` audit rows): who saved it,
  when, its age and fingerprint — never the key; over 180 days it says to consider replacing it; a key saved before key
  changes were recorded says so. **Rotation checklist** (`rotationChecklistAction`, `security:rotation_since`): after a leak,
  start one and each stored key ticks off once it's been replaced since. There is no live "test the key" button — it would
  spend the tenant's credits.
- **Access review** (E-SEC-18): `getCurrentUser` refreshes `User.lastActivityAt` at most hourly; People flags active members
  not seen in 60+ days (`IDLE_DAYS`) — or never signed in, counted from joining. Nothing is revoked automatically.

## ⚠ Incident mode; shared accounts wait for the operator (2026-10-29, audit Phase 5, security part 4)
- **Incident mode** (E-SEC-06, Settings → Incident, `/admin/incident`, operator only, `actions/incident.ts`, `lib/incident.ts`): the
  operator writes what happened and picks steps — sign everyone out, void open invitations (expired, rows kept), revoke every
  API token, disconnect YouTube and Analytics sign-ins (`RECONNECT_KEYS`; Drive storage is left alone) — each with its count
  shown first, behind a confirmation. Every workspace's audit log gets `security.incident_declared` with its own counts (so its
  admins are told) and admins see a red banner until the operator ends it (`security.incident_ended`; nothing is undone).
- **Signing everyone out is a moment, not a list** (`security:sessions_valid_after`, platform Setting): the jwt callback in
  `auth.ts` stamps `signedInAt` at sign-in and returns null (Auth.js clears the cookie) for a session signed in before that
  moment — sessions from before the check existed carry no stamp and count as old. 30 s settings cache, so it lands within
  that window on every replica. With no moment set it does nothing, so deploying it signed nobody out.
- **Unclaimed accounts** (E-SEC-15, `/admin/unclaimed`, from Workspaces, `lib/unclaimed-accounts.ts`): mailboxes on the shared
  Unipile team and profiles on the PLATFORM Zernio key that no workspace owns. The operator assigns each (re-read at assign
  time, audited `integration.adopted`, so the workspace's admins hear). A profile named `ws_<id>` goes back only to that
  workspace; one whose workspace is deleted is never assignable; a workspace with its own Zernio key or a profile can't take
  one. ⚠ **Refresh from Unipile no longer adopts unclaimed mailboxes for anyone** — the operator's refresh used to pull them into
  whatever workspace the cookie said.

## ⚠ Stored files have an owner (2026-10-29, audit Phase 5, security part 5)
- **`storage.put(name, data, type, owner)` — `owner` is required** (E-SEC-11, `OwnedStorage` in `lib/storage/index.ts`): the
  workspace whose members may open the file, recorded as a `StoredObject` row (migration `20261029110000_stored_object_owner`,
  `recordOwner` in `lib/storage/owners.ts`). Pass `null` only for a file that belongs to no workspace. Every caller passes
  its workspace — uploads, media, social and caption images, logos, brand documents, generated images, voiceovers, Veo
  output, assembled and branded videos. The providers themselves (`localProvider`, `gdriveProvider`) don't record owners;
  never call their `put` from feature code.
- **`/uploads/<key>` and `/api/files/<key>` ask `mayOpen`**: an owned file opens for active members of its workspace (any of
  them, whichever workspace is active) and the platform operator; anyone else gets 404 (not 403 — no confirmation it
  exists), checked before Drive is called. ⚠ **Files stored before 2026-10-29 have no owner row and keep the old rule** (any
  signed-in member; keys are unguessable). Owners were deliberately NOT back-filled — guessing the owner of LSI's and
  CF's files from references could lock a tenant out of its own images; a back-fill is the operator's call.

## ⚠ Two-factor sign-in (2026-10-29, audit Phase 5, security part 6)
- **TOTP on node:crypto** (E-SEC-07, `lib/totp.ts` — checked against RFC 6238's vectors; no dependency) and `lib/two-factor.ts`:
  the secret is stored AES-GCM encrypted (`blog-crypto`, TOKEN_ENCRYPTION_KEY) on `User.totpSecret`; `totpEnabledAt` means on;
  `totpLastStep` is claimed in a conditional update so a code works once; `totpRecovery` holds ten sha256 hashes, each removed
  (conditionally) as it's used. Migration `20261029120000_two_factor`.
- **Sign-in is two steps**: `authorize` throws `SecondFactorRequired` (a `CredentialsSignin` with `code = "second_factor"`) when
  the password is right and two-factor is on — so posting a password straight to `/api/auth/callback/credentials` never makes a
  session. The sign-in page catches it, sets `mys.2fa_pending` (a five-minute HMAC token naming the user, path `/signin`) and asks
  for the code; step two calls `signIn("credentials", { pending, code })`. Codes are rate-limited (`totpPerUser`, 10 per 5 min).
  ⚠ Google SSO (if ever enabled) doesn't ask for the code — Google's own two-factor applies there.
- **Set up at `/account/two-factor`** — in the `(auth)` group, OUTSIDE the app shell, because a workspace that requires it
  (`security:require_2fa_admins`, People → "Require it"; the admin must have it on first) sends its admins there from
  `requireMembership` — every page, action and route — until it's on. Editors and viewers aren't held. An admin can't turn it
  off while a workspace they administer requires it. ⚠ New recovery codes reach the page through a two-minute, encrypted,
  httpOnly cookie scoped to it (`CODES_COOKIE`) and a redirect to `?codes=1` — NOT useActionState: the page re-renders into its
  "on" branch and threw the client state (and the codes) away before anyone saw them.
- People shows "two-factor on" / "no two-factor" (admins); the platform operator gets **Turn off two-factor** for someone who
  lost their phone and codes (`resetTwoFactorAction`). Turning it off, a reset and the requirement changing are audited in each
  workspace the person belongs to and sent to its admins. The operator's own account gets an amber nudge — NOT forced: the
  audit asked for "required for the operator"; forcing it is the owner's call.


## ⚠ Every stored secret is on the keyring (2026-10-31, audit Phase 5, security part 7)
- **`lib/keyring.ts`** (E-SEC-04): `TOKEN_ENCRYPTION_KEY` is the current key (new secrets are written with it);
  `TOKEN_ENCRYPTION_KEY_PREVIOUS` (comma-separated) holds older keys that are still READ, never written. A key's id is
  the first 8 hex of `sha256("mys-keyring:" + key)` — nothing else to configure. `blog-crypto`'s `encryptSecret` now
  writes `{kid, iv, tag, data}`; a value from before has no `kid` and is opened by trying each key (GCM's tag decides).
- **Secret settings are sealed at rest by the db client** (`lib/db.ts`, a `$extends` query hook on Setting and
  WorkspaceSetting): keys matching `isSecretSetting` — `api_key:*`, `email:smtp`, `*:api_key`, `*:client_secret`,
  `*:webhook_secret`, `*:service_account`, `*:password` — are stored `enc:v1:<kid>:<iv>:<tag>:<data>` on every
  create / update / upsert / createMany / updateMany, and every read returns the plain value. So `getSetting`, the pages
  that query the tables directly and the webhook's secret scan all see plain text unchanged. A plain row from before
  reads as it is (read-both); `*:refresh_token` rows stay their callers' sealed JSON. ⚠ Don't filter a secret setting
  by `value` in a `where` (it's ciphertext in the table); `value: { not: "" }` is fine. ⚠ `baseDb` is the client
  WITHOUT the hook — only for the keyring sweep and the Auth.js adapter; never read a secret through it.
- **A secret no configured key opens reads as not set** (`""`, logged once per key id) — never as ciphertext handed to a
  provider. With no `TOKEN_ENCRYPTION_KEY` at all, secret settings are written plain (as before) with a warning, and
  `encryptSecret` refuses (WordPress, Google sign-ins and two-factor can't be saved).
- **Settings → Keyring** (`/admin/keyring`, operator only; `lib/keyring-sweep.ts`): counts per place (settings, Google
  sign-ins, WordPress passwords, two-factor secrets) by state — current key / older key / no key id yet / not encrypted /
  can't be read (listed with workspace, setting name and key id; never a value) — and **Re-encrypt** behind a tick. Each
  row is replaced only if it still holds the value that was read (a save in between wins and is counted); affected
  workspaces get a `security.keyring_reencrypted` audit row (no notice — no key changed). ⚠ **The operator runs it, never
  an agent**: it rewrites LSI's and CF's secrets. Until it's run, production's existing keys stay plain text.
- **Rotation**: current key → `TOKEN_ENCRYPTION_KEY_PREVIOUS`, new key → `TOKEN_ENCRYPTION_KEY`, deploy, Re-encrypt,
  then drop the old key once no row shows it ("nothing uses it — safe to remove" on the page). Removing a key in use
  makes those secrets unreadable; they'd have to be entered again.

## ⚠ Deleting a workspace keeps it for 30 days (2026-11-01, audit Phase 5, security part 8)
- **Soft delete** (E-SEC-14, `lib/workspace-lifecycle.ts`, migration `20261031100000_workspace_soft_delete`): both delete
  paths — an admin's Settings → Delete (the registry's `workspace.remove`) and the operator's Workspaces → Delete — call
  `softDeleteWorkspace`: `deletedAt`, `deletedById`, `purgeAfter` = +`RESTORE_DAYS` (30), the engine's global pause ON with
  the earlier state kept in `pausedBeforeDelete`. Audited once as `workspace.deleted` (the registry's `auditsItself` skips
  `entity.deleted`); its other admins get a security notice; a tenant admin's delete tells the operator (`tellOperator`: an
  Inbox notification in a live workspace of theirs, emailed per preferences).
- **A deleted workspace is no one's to open**: `getCurrentUser` includes only memberships of live workspaces, so
  requireMembership, the switcher, file access (`mayOpen`) and every page skip it; `activeWorkspaceIdFor`, Settings'
  own workspace list and app mail's mailbox choice (`appEmailFor`) filter `workspace: { deletedAt: null }` too — ⚠ so must
  any new query of a person's memberships. Its API
  tokens are refused (`apiCaller`), its invitations can't be claimed or shown, nobody can be added or entered into it, and
  the unclaimed-accounts queue won't give it anything. A member whose only workspace it was lands on /onboarding/workspace,
  which names it and the restore deadline. Sweeps that list workspaces take `deletedAt: null` (analytics, autopilot,
  digest, rollup, recommendations, account health, social performance); the pause stops the per-entity ones (social
  publish, jobs). ⚠ A new sweep that lists workspaces must filter `deletedAt: null` too.
- **Restore** (operator, Workspaces → Deleted): clears the fields and puts the pause back as it was; tokens and invitations
  work again. Refused once a purge has started.
- **Purge** (the metrics sweep's `purgeDueWorkspaces` after `purgeAfter`, or the operator's typed "Purge now"), claimed by a
  conditional `purgeStartedAt` (re-runnable after an hour if it died): Google refresh tokens revoked (`oauth2.googleapis.com/
  revoke`; 400 = already invalid, counted done), Unipile mailboxes DELETEd at the platform's Unipile, the Zernio profile
  DELETEd at the platform's Zernio — ⚠ unless the workspace has its own Zernio key (that account is the company's; left
  alone and said so), stored files removed (`storage.remove`, local unlink or Drive DELETE), then the rows. Every step is
  attempted and recorded (`workspaces:purged`, last 50) for the Purged list and the operator's notice. ⚠ `StoredObject.
  workspaceId` is now nullable with SetNull: a file whose removal failed outlives the workspace with no owner and only the
  operator can open it — never the legacy "any signed-in member" rule (that's for files with NO row).
- **Export** (`/api/workspaces/[id]/export`): the workspace's admins (live) or the operator (any, deleted included) get one
  streamed JSON file — every model with a `workspaceId` (from Prisma's DMMF, caches and the job queue left out) plus its
  channels' rows, members with their email. Never a secret: password/token/secret fields dropped by name, secret settings
  `[not exported]`. Linked from Settings → Workspace, the delete copy and the Deleted list; audited `workspace.exported`.

## ⚠ Who may join, how they sign in, when idle access ends (2026-11-01, audit Phase 5, security part 9)
- **`lib/access-policy.ts`** (E-SEC-08, E-SEC-18), set on Settings → People → Access (`saveAccessPolicyAction`, admins;
  audited `security.access_policy_changed`, which tells the other admins):
  - `security:allowed_domains` — invitations and new members only at these domains (`joinRefusal`): the People invite,
    the assistant's `invite_member`, the operator's add-member and **`claimInvitation`** (an invitation from before the rule
    is held to it). Existing members outside are flagged on People, never removed. An admin must keep their own domain in.
  - `security:require_google_signin` — only when the install has Google SSO (`ENABLE_GOOGLE_SSO` + client id/secret):
    `authorize`'s password path throws `GoogleSignInRequired` (`code = "use_google"`) for anyone actively in a live
    workspace that requires it; the sign-in page says to use Google. ⚠ The platform operator is exempt — the way back in.
    Off on this install today (SSO isn't enabled), so the box is disabled with the reason.
  - `security:auto_expire_days` (60/90/180, off by default) — `expireIdleMembers`, in the metrics sweep: active EDITORs
    and VIEWERs whose last activity (or joining, if never seen) is older are revoked (`membership.expired`, admins told).
    ⚠ Never an ADMIN (a workspace can't lock itself out) and never the operator.
- SAML / per-workspace identity providers are NOT built (E-SEC-08's "later"); Google is the install's one SSO.

## ⚠ Ideas: drafting order, Not yet, stale flags, lane health (2026-11-01, audit Phase 5, growth part a)
- **Priority is the lever** (E-IDE-08): `DRAFT_ORDER` (lib/idea-drafting.ts) — highest `priority` first, unscored last, then
  the longest-waiting — is what the autopilot and Auto-draft approved use; the board numbers approved articles the same way
  ("next to draft", "#2 to draft"; a site change takes no place). Discovery's `ideationCells` sorts emptiest-first WEIGHTED by
  the Topic's priority (`open / (1 + priority)`), so a priority-2 Topic is kept three times as full as a priority-0 one.
- **Not yet** (E-IDE-25): an approved article or social idea goes back to Discovered without being rejected (audited
  `ideas.snoozed` / `social.idea_snoozed`; a social idea's `approvedAt` is cleared).
- **Stale triage** (E-IDE-23, lib/home.ts — so the Inbox AND the digest): the triage card adds "· N waiting more than a
  week" (discovered and untouched 7+ days — `updatedAt`, so a "Not yet" restarts the clock); a WARN card "N approved ideas haven't been made in a week" names the drafting blocker when
  there is one. ⚠ An article idea keeps no approval time — its `updatedAt` stands in (any edit resets it).
- **Lane health** (E-IDE-20, lib/lane-health.ts) in each Topic lane's header: last idea, approval rate (approved / drafted /
  merged out of all decided), articles published + social posts sent under the Topic, and the 7+-day backlog in amber.

## ⚠ Pause the social queue only; failed sends are told at once (2026-11-01, audit Phase 5, growth part b)
- **Social queue pause** (E-SOC-06, `lib/social/queue-pause.ts`, Settings → Automation → Social queue, admins):
  `social:queue_paused` = `{since, by, note}`. `publishDueSocialPosts` skips those workspaces alongside the global pause, and
  the evergreen recycler adds nothing to them; articles, discovery and every other dial carry on. Shown on Automation, the
  Queue page and as a WARN Inbox card. ⚠ **Resume** asks what to do with posts whose time passed while paused (they'd all go
  out at once): "put them in the next free slots" (default — `claimNextFreeSlot` in order, `timeChosen` false; one with no
  free slot goes back to Drafts with its time, never out) or "send them now". The setting is cleared only after the moves.
- **Failure alerts** (E-SOC-22, `lib/social/send-alerts.ts`): every place a post's status is rolled up from its legs — the
  send, the stuck-send reconciler and the Zernio webhook — calls `alertSendFailure`: a `publish_failed` notification to
  admins and editors linking the post (to retry), and when a leg's error reads like a lost connection an `account_broken`
  one linking Connections. Both de-duplicated for a day by notify (`DEDUPE_HOURS`; reconnect per network). Never throws.

## ⚠ Polling backs off; long strips fold; the Inbox streams; notices roll up (2026-11-01, audit Phase 5, growth part c)
- **Poll pacing** (E-PRF-04, `components/poll-pace.ts`): `pollDelay(base)` — base while someone's using the page, ×4
  after 5 idle minutes, ×10 after 30 (input anywhere counts). ShellPoll (`/api/shell`) and AutoRefresh schedule with it via
  `setTimeout`, never poll a hidden tab, and read at once on becoming visible or on the first input after an idle spell.
  The script agent panel skips hidden ticks. ⚠ A new poller uses `pollDelay` and checks `document.hidden`.
- **Stage strip "More ▾"** (E-SHL-13): a stage with more than `INLINE + 1` (7) tabs shows the first 6 inline between
  phone and `xl` widths and folds the rest into a More menu with their badges summed (red if any is urgent); the tab
  you're on is never folded; phones keep the scrolling row and `xl` shows everything.
- **The Inbox streams** (E-SHL-14): its own `loading.tsx` skeleton, and Results (the weekly series and post performance,
  its slowest reads) is an async section behind `<Suspense>` so the cards that need someone arrive first.
- **Notification roll-ups** (E-ENG-18, lib/notify.ts): `DEDUPE_HOURS` covers approvals, decisions, schedules, publishes and
  failed generations as well as failures — one item per kind, thing and title a day. A repeated failure
  (`publish_failed`, `generation_failed`, `account_broken`) updates the item already there — "(repeated N times today)",
  back to unread, no second email. Past 3 different failed generations in a day, further ones roll into one "Several AI
  generations failed today" item (`entityId rollup:<date>`). `security`, `comment` and `assigned` are never folded.

## ⚠ Articles: overlap checks, complete structured data, website health (2026-11-01, audit Phase 5, growth part d)
- **Overlap** (E-ART-13, `lib/blog-overlap.ts`): the editor's checks add two ADVISORY rows — another article in the
  workspace on the same focus keyword (case and spacing aside) or the same slug, named with its stage. Never part of the
  gate: they're appended after `gatesSatisfied` reads the list.
- **Structured data** (E-ART-14, `lib/blog-jsonld.ts`): Article gets `image` (only a public http(s) URL — never app
  storage), `dateModified` (never before it went live), `mainEntityOfPage`, and the article's expert (`smeProfileId`) as a
  `Person` author working for the organisation; a `BreadcrumbList` (site home → article) once it has a public URL; FAQPage
  as before. ⚠ The JSON is embedded in a `<script>`, so every `<` is written `<` — a title can't close the tag.
  Publishing passes the public OG image, the expert and the WordPress base URL; the HTML export passes the expert.
- **Website health** (E-ART-16, `lib/wp-health.ts`): the read-only `/users/me` probe runs with the analytics sweep and on
  Website → Health → Test now (admins); `wordpress:last_probe` keeps `{at, ok, detail, fails}`. ⚠ The connection reads
  "error" only after TWO failures in a row (one blip never flags it), and its admins get one `account_broken` notice on the
  flip; recovery clears it at once. Publishing doesn't read `status`. The card also shows the latest `publishReport`: SEO
  fields stored of sent, featured image, body images, categories/tags the site didn't have.

## ⚠ Recommendations have a lifecycle; CTR and weighted position; the autonomy preview (2026-11-01, audit Phase 5, growth part e)
- **Recommendation lifecycle** (E-MEA-13): each open card says how long it's been open; **Snooze a week**
  (`snoozeRecommendationAction`, editors) sets `status: "snoozed"` — suppressed while `updatedAt` is within `SNOOZE_DAYS`
  (7); after that, a finding still true WAKES the same row (back to open, first-seen kept) instead of creating another;
  one whose condition cleared is resolved like an open one. The resolved list now includes `resolved` ("cleared on its
  own") and snoozed rows (with the day they may return), each with its open → closed dates.
- **Search metrics** (E-MEA-16, `collectPerformance`): `search_ctr` = clicks ÷ impressions over snapshots that carry
  both (null, not 0, when none do); `avg_position` is impression-weighted as Search Console averages it, a plain mean
  (said so in its evidence) only when no snapshot has impressions. GA4 conversions are NOT synced yet.
- **Autonomy preview** (E-SET-06, `autonomyPreview`): beside the full-autonomy switch, off → each row turning it on
  changes (functions to auto from their current mode, queue-on-approval, the social idea gate); on → what switching off
  puts back, from the snapshot taken when it went on. Rows that wouldn't change are left out.

## ⚠ Ideas in spreadsheets; people basics; contextual help (2026-11-01, audit Phase 5, growth part f)
- **CSV** (E-IDE-24, `lib/csv.ts`): RFC 4180 with a BOM. ⚠ A cell starting `= + - @` (or tab/CR) is exported with a
  leading apostrophe so a spreadsheet can't run it as a formula; import strips it back. `/api/ideas/export?kind=articles |
  social | keywords` (any member, active workspace). `importIdeasCsvAction` (editors; 1 MB, 500 rows): articles need a
  `title` column — they arrive as **Discovered** (approval stays a person's), Topic matched by name (unknown → no Topic,
  named in the flash), `priority` 0–100 kept, duplicates of open ideas skipped; keywords need `phrase` (tier/intent/
  cluster/notes read). Audited `ideas.imported`. Controls in a "Spreadsheet" disclosure on Ideas and Keywords.
- **People** (E-SET-02): the invite field takes up to 20 addresses (commas, spaces, lines) — each checked against the
  workspace's domains, its own invitation, email and audit; the flash names who wasn't invited and why. Pending invitations
  show "expired" (rose) or "tomorrow / in N days" (amber within two days), **Resend** (same link, seven more days,
  `membership.invite_resent`) and **Copy link**. A revoked member has **Reinstate** (the role they had), audited as
  `membership.added` (via reinstated) so an admin coming back tells the other admins.
- **Contextual help** (E-SHL-11): each stage strip ends with a "?" to its Help category (`HELP_FOR` in StageStrip); Help
  takes `?cat=` and `?q=`, every answer is `<details id="faq-<cat>-<slug of question>">` with a # link and opens on its
  hash; "/" focuses the search unless someone is typing.

## ⚠ The assistant's run history and conversations (2026-11-01, audit Phase 5, growth part g)
- **Run history** (E-ENG-10, `/assistant/history`): every `assistant.tool_run` (write tools only — reads change
  nothing): when, who (admins see the workspace; editors their own), the tool, its arguments summarised, done / failed
  with the error, and the conversation — linked only when it's the viewer's own (threads are private). `ToolContext`
  carries `threadId`; `runTool` records it as the audit row's `entityId` and in `meta`. Filter by tool or failures.
- **Conversations** (E-ENG-11): `/assistant` lists your own 30 most recent, searchable over titles AND message text
  (`?tq=`); rename and delete (with a tick) via `actions/assistant-threads.ts`, both scoped to `userId`. Deleting keeps
  the run history. The dock starts a NEW conversation when the remembered one has been idle over 6 hours
  (`IDLE_FRESH_MS`, unless a proposal is waiting) and says so; its header has a picker of recent conversations
  (`GET /api/assistant` returns them; a thread's GET returns `updatedAt`).

## ⚠ Discover any format per Topic; post lists on phones; the bundle check (2026-11-01, audit Phase 5, growth part h)
- **Discover** (E-IDE-07): the board's Discover takes a format — article, social post, or both — and a Topic (or the
  emptiest), all through `discoverIdeasAction` → `runIdeation`. When every Topic is at the manual ceiling for ARTICLES
  the article choices are disabled but social stays (each format's ceiling is its own, enforced in `runIdeation`).
- **Phone lists** (E-SOC-13, components/PostList.tsx): below `md` the Queue / Sent / Drafts table renders each row as a
  card (`max-md:` classes on table, rows and cells; the header hidden); nothing changed at `md` and up.
- **Bundle check** (E-PRF-03, `scripts/check-bundle.mts`, `postbuild` — so Railway's build runs it too): fails the build
  when a client chunk in `.next/static/chunks` carries the Node crypto polyfill (`createECDH`/`secp256k1`), the Prisma
  client, or a server secret's name, when any chunk passes 600 KB, or the total passes 4 MB (2026-11-01: largest 228 KB,
  total 1.25 MB). ⚠ If it fires, find the client component that imports server code — don't raise the budget to pass.

## ⚠ Saved hashtag sets and snippets (2026-11-01, audit Phase 5, growth part i)
- **`SocialSnippet`** (E-SOC-10, migration `20261101090000_social_snippets`): `name`, `body`, optional `category` (null =
  offered for every post), per workspace, up to 100. Managed on Distribute → Compose ("Saved hashtag sets and
  snippets", `actions/social-snippets.ts`, editors). The composer (new and edit) shows an **Insert** chip per snippet whose
  category is empty or matches the post's category; a click puts the text at the cursor, or at the end (a multi-line
  snippet on a new paragraph). Caption Studio doesn't offer them yet.

## ⚠ Connections: needed vs optional, and whose key (2026-11-01, audit Phase 5, growth part j)
- **`ConnRow.required`** (E-SET-03, lib/setup-status.ts): `REQUIRED` = writing (LLM), live web search, images and social
  accounts — the daily loop stops without them. Only those count in Connections' "N things the loop needs are missing"
  and the Settings overview's "N missing"; the rest are "optional extras not set up". Each row shows "needed" / "optional".
- **`ConnRow.source`**: for key-backed rows that are connected, whose key it reads — "this workspace's key", "the
  platform's key" or "the server's environment" (`keySource`, the same order the providers resolve). The assistant's
  `list_connections` says both. ⚠ A new connection row decides `required` by adding its key to `REQUIRED` or not.
- No live Test button (E-SEC-03's reason stands: it would spend tenants' credits).

## ⚠ The video studio is read-only for viewers (2026-11-01, audit Phase 5, growth part k)
- **E-VID-12**: viewers read the studio instead of meeting controls that bounce them to /forbidden. Script page: no
  Builder link, agent, Track in production, Start over, title/model/template form or snapshot restore — the Plan tab shows
  the answers and outline as text and the Script tab the script as text (the editor autosaves, so it's never a viewer's);
  a "Read-only" note in the toolbar. Production board: no New project, advance, topic form or delete. Thumbnails: the
  concepts made so far, not the tools or delete. Every action keeps its own `requireRole("EDITOR")` — this hides, the
  actions refuse. The Videos pages already gated their controls.

## ⚠ Wide report tables become cards on phones (2026-11-01, audit Phase 5, growth part l)
- **E-MEA-20**: Measure → Topics (11 columns) and the YouTube video table render below `md` as one card per row of
  "label: value" lines — each `<td>` carries `data-label` and a `max-md:before:content-[attr(data-label)]` class, the
  header row is hidden, the row is a block. ⚠ A column added to either table needs its `data-label` too, or its phone
  line has no name. Unchanged at `md` and up.
- **The Measure range picker fits a phone**: below `md` its two date inputs take their own row and shrink to share it
  (`max-md:flex-1 max-md:min-w-0`) — at natural width they ran 11px past a 375px screen and `<main>` scrolled sideways.

## ⚠ Each project has an upload checklist; its page is read-only for viewers (2026-11-01, audit Phase 5, growth part m)
- **E-VID-04**: `ContentProject.uploadChecklist` (JSON `{ step: { at, by } }`, migration `20261101120000_upload_checklist`)
  holds seven steps — Script final, Recorded, Edited, Thumbnail, Title/description/tags, Captions, Uploaded
  (`lib/upload-checklist.ts` `UPLOAD_STEPS`). Every tick is a person's: nothing records filming or captions and a
  script's status never leaves "draft", so the app ticks nothing itself. The Thumbnail step shows "n made in the
  studio" as a HINT (thumbnails on the project's script), never as a tick. `readChecklist` drops unknown or malformed
  entries, so a bad stored value reads as nothing ticked.
- **`setUploadStepAction`** (EDITOR) takes the direction (`done` 1/0), so a double submit lands where it was aimed, and
  writes conditionally on the JSON it read (up to three tries) — two editors ticking different steps at once both stick.
- The board card's "Upload n/7 →" is the link to `/production/projects/[id]`, which the board never had. All seven
  ticked with the status not Published → a nudge to set it.
- **The project page is read-only for viewers** (E-VID-12, missed by part k): status and target date as text; no
  status, date, merit, keyword, repurpose or SOP forms; the checklist without tick buttons.

## ⚠ Research reports you can use; generated blocks say who wrote them (2026-11-01, audit Phase 5, growth part n)
- **E-IDE-15**: a deep-research report (`ResearchSource.kind = "ai_research"`) renders through `MarkdownMessage` (no raw
  HTML); other sources stay as extracted text. New reports store `writtenBy` (a provenance stamp) and `webSources`
  (JSON `[{ title, url }]` of the web results the model was given, http(s) only — filtered again on read). "Make ideas
  from this report" (`ideasFromReportAction`, EDITOR) turns the report's own **Suggested angles** list into `new` ideas
  on its channel — parsed by `lib/report-angles.ts` `anglesFromReport`, not asked of a model again, so it costs nothing
  and makes nothing when the report has no such list. A title the channel already has is skipped and the flash says so.
  The research page is read-only for viewers (no run, star, delete or make-ideas) and dates use `formatZonedMoment`.
- **E-VID-13 provenance**: `lib/provenance.ts` `passStamp(res)` = `"provider|model|ISO"`, where provider is the one that
  ANSWERED (the router's stamp, fallback included). `Script.outlineBy` / `Script.bodyBy` are written by every model
  write — canvas outline/script/humanize/improve, builder draft and section regenerate, the agent job's six steps, the
  streaming route — and cleared by a restore (of the part restored) and by Start over. `components/ProvenanceChip.tsx`
  shows the model's label, or amber **"Mock — AI unavailable"**; no stamp → no chip (text from before stamps claims
  nothing — never guessed from the model a person picked). Migration `20261101130000_generated_provenance`.
- **The streaming route refuses the mock** (a VID-05 gap): `llm.stream` had no way to say who answered, so
  `/api/scripts/[id]/generate` saved mock prose as the outline or script. `LLMRequest.answeredBy` is now filled by the
  router (provider + model it picked) and flipped to `"mock"` by the fallback wrapper; the route runs
  `placeholderProblem` before writing and ends with `event: error` + the reason, which `StreamButton` shows instead of
  going quiet. ⚠ Any new streaming write must pass `answeredBy` and check it the same way.

## ⚠ Every report table downloads as CSV (2026-11-01, audit Phase 5, growth part o)
- **E-MEA-02**: `components/CsvButton.tsx` sits over each report table — Measure overview (articles, last 28 days),
  Measure → Topics, the YouTube videos table, Insights (Topics, By network), Blog analytics, Blog report (Top content)
  and the Reports blocks (content, social by network, topics). The table carries `data-csv="<key>"`; the button
  serializes what the table SHOWS through `lib/csv.ts` `toCsv` (BOM, RFC 4180
  quoting, formula-looking cells prefixed with `'`), so the file can't disagree with the page. A dash cell exports
  **blank** — unmeasured is never 0 or "—" in a sheet. A multi-row header is laid out as a grid (row/col spans), so
  each column is named once and in full ("Articles: Out / made") and lines up with its cells — taking only the last
  header row shifted every Topics column. `print:hidden`. ⚠ A new report table gets `data-csv` and a
  `CsvButton`; a cell whose value is only a bar or an icon exports blank. XLSX would need a new dependency — the
  owner's call, not done.

## ⚠ Viewers get a read-only assistant (2026-11-01, audit Phase 5, growth part p)
- **E-ENG-15**: the Ask dock and `/api/assistant` admit every member. A viewer's turn may call only
  `VIEWER_TOOLS` (lib/assistant/tools.ts) — in-app reads like pipeline_status, inbox_items, list_* and
  results_summary — and each must ALSO be `readOnly`; `toolAllowedFor(tool, role)` checks both. NOT a viewer's: the
  read tools that spend outside credits (search_web, read_web_page, analyze_youtube_video, intel_*, research_competitor,
  youtube_audit) and the ones that show settings (settings_status, connections_status). It is enforced in four places:
  the tool manual the model is shown, before a call can become a proposal (so a viewer never gets a Yes card), when an
  earlier proposal is confirmed, and in `runTool`. A viewer's prompt says they're a viewer and to name who can make a
  change. The dock says it only looks things up and has no link to `/assistant`, which stays EDITOR (its viewer message
  points at the Ask button); the run history stays EDITOR. ⚠ A new read tool is an editor's until it's added to
  `VIEWER_TOOLS` on purpose.

## ⚠ Posting slots follow the data (2026-11-01, audit Phase 5, growth part q)
- **E-SOC-18, edit in place**: each slot's time on Settings → Schedule opens a small editor (time, day, category) →
  `updatePostingSlotAction` (ADMIN). A category-only edit just saves. A move refuses a time another slot has, writes
  conditionally on the slot still being where it was read, and the posts the QUEUE put in it move WITH it
  (`lib/social/slots.ts` `moveQueuedPosts`: same week, new weekday and time; a post whose new moment has passed goes
  back to drafts; hand-timed posts — `timeChosen` — keep their moment). Audited as `social.slot_moved`.
- **"Fill from best times"** (`addBestTimeSlotsAction`) adds a general slot at every measured best time without one,
  recomputed on the server from `analyseBestTimes` — refuses with the analysis's own reason when the evidence is thin.
- **Underperforming slots**: an enabled slot whose hour bucket is in the judged `worst` list gets "Your Tue 09:00 slot
  posts at a time that measures 0.7×" and, while a better unslotted time exists, "Move it to Wed 14:00 (1.6×)" — one
  suggestion per slot, so two slots are never sent to the same time.

## ⚠ The public topic form has controls (2026-11-01, audit Phase 5, growth part r)
- **E-SET-08**: `Channel.submissionsOpen` (default true — the old behaviour) and `Channel.submitSlug` (unique across the
  install; migration `20261101140000_submission_form_controls`). `/submit/<slug-or-id>` resolves through
  `lib/submit-form.ts` `channelForSubmit` (slug first) and refuses a channel whose workspace is soft-deleted — the form
  ignored security part 8 before. Closed → the page says so with no fields, and a post from an old tab is told
  `error=closed` and stores nothing.
- **Spam**: an off-screen honeypot field (`website`, `aria-hidden`, `tabIndex=-1`) — a bot that fills it is thanked and
  nothing is stored; and `rate-limit.ts` `submitPerIp` (5 per address per channel per 10 minutes; the honeypot is
  checked first and doesn't count) → `error=slow` with a sentence.
- **Notice**: each stored suggestion → `notify` kind `submission` (admins and editors, in-app; email off by default),
  deduped per channel per day with the repeat count on the one item.
- **Controls** on the channel's Submissions page are ADMIN (`saveSubmitFormAction`: open/closed, slug). `slugProblem`
  refuses anything but 3–40 lowercase letters/digits/dashes and anything shaped like a record id (it could shadow
  another channel's `/submit/<id>`); a taken slug is refused by name.

## ⚠ Unfinished channels can be resumed or let go; a dial says who starts one (2026-11-01, audit Phase 5, growth part s)
- **E-SET-09**: a channel is a DRAFT until wizard step 4 saves `differentiation` (that step starts the voice,
  audience and ideas jobs). `lib/channel-drafts.ts` `draftChannels` lists them with `resume` (the first step not done:
  2 while still "Untitled channel", 3 with no competitors, else 4), `empty` (nothing hangs off it but competitors) and
  `stale` (empty and untouched for `STALE_DRAFT_DAYS` = 7). The wizard's first page shows "Unfinished channels" with
  Resume and, for empty drafts only, Discard (`discardDraftChannelAction`, conditional on still being a draft,
  audited); an admin gets "Clear n older than 7 days" (`clearStaleDraftChannelsAction`). A draft with content goes
  through the usual admin channel delete.
- **Who may start channels** — `channels:creators` on Settings → Workspace: empty = editors and admins (as before),
  `admins` = admins only. `mayCreateChannels` gates the wizard page (an editor is told why), `startOnboardingAction`,
  every later step (`requireOwn` — continuing is starting) and Discard.

## ⚠ Research ideas can take a remixed title (2026-11-01, audit Phase 5, growth part t)
- **E-IDE-21**: Research's idea form (`ResearchIdeaForm`, wherever it has Topics) carries `TitleRemix`: "Remix the
  title for the Topic" → `remixTitlesAction(videoId, topicId)` (EDITOR; video and Topic workspace-scoped; refuses
  without a Topic) → `lib/title-remix.ts` `remixTitles` asks for three titles that keep the hook and change the
  subject, refuses the mock's answer (`placeholderProblem`), and `parseRemixes` strips list furniture and quotes and
  drops the original and repeats (max 3). Picking one fills the form's hidden `title`; "Keep the original" clears it.
- `ideaFromResearchAction` stores the picked title (article, video or social hook) and keeps the competitor's own title
  in the angle as the evidence ("… with “<their title>” — this title keeps its hook on a new subject"); no pick = the
  original title, as before. Without JavaScript the form still works.

## ⚠ Topics can be renamed, merged and safely deleted (2026-11-01, audit Phase 5, growth part u)
- **E-IDE-06, rename** (EDITOR): `updateTopicAction` takes an optional `name`; a name another Topic here already has —
  compared case-insensitively — is refused with "merge into it instead" rather than tripping the unique index.
- **Merge** (ADMIN, `mergeTopicAction` → `lib/topic-ops.ts` `mergeTopics`): one transaction re-tags every relation —
  BlogPost, BlogIdea, SocialIdea, Idea, VideoRender, ContentProject, SocialPost and RssFeed (a plain `topicId` column,
  no relation) — unions the related phrases (plus the merged Topic's name), keeps the higher priority, deletes the
  merged Topic, and is audited `topic.merged`. ⚠ A new model with a `topicId` must join the merge list and the delete.
- **Delete** went from a bespoke EDITOR action to the DeleteButton registry: kind `topic`, ADMIN. It takes the TAG off
  (relations SetNull; RssFeed cleared by hand) and deletes no content, so the button carries a `warning` with the counts
  — not the registry's "Also deleted" impact list, which would say the opposite of what happens.

## ⚠ The background queue has a page; a job that gives up says so (2026-11-01, audit Phase 5, growth part v)
- **E-ENG-17**: Settings → **Jobs** (`/admin/jobs`, ADMIN via admin/layout) lists THIS workspace's jobs
  (`lib/jobs/admin.ts` `jobsOverview`): "Needs a look" = running, retrying (queued with attempts > 0) and failed this
  week; Waiting / Running / Failed (7 days) / Done (24 h) tabs with counts. Rows use people's labels (`JOB_LABELS`; an
  unknown name shows raw), tries n/max, the next-try time for a backed-off retry, the error and a running job's progress.
- **Retry** (`retryJobAction`): failed → queued with attempts 0 and no wait, conditional on still being failed;
  **Cancel** (`cancelJobAction`): QUEUED only → failed "Cancelled by <name>". A running job isn't cancelled here — its
  handler owns stopping it (the agent and renders have their own Cancel). Both audited (`job.retried`, `job.cancelled`).
- **The give-up notice**: when a job uses its last attempt (a handler's final throw, or a stalled run out of
  attempts) `noticeGaveUp` in `lib/jobs/index.ts` sends notify kind `job_failed` — ADMINS only, in-app, one item per
  job kind a day with the repeat count — linking to `/admin/jobs?state=failed`. A failure with attempts left tells
  nobody. ⚠ A new job name gets a `JOB_LABELS` entry.

## ⚠ A rejection can say why, be undone, and steer discovery (2026-11-01, audit Phase 5, growth part w)
- **E-IDE-18**: `BlogIdea.rejectReason` / `SocialIdea.rejectReason` (migration `20261101150000_idea_reject_reason`),
  keys from `lib/reject-reasons.ts` `REJECT_REASONS` (off_brand, duplicate, too_broad, wrong_audience). A reason can
  ride the reject itself (`reason` on the status form) or be added after; ANY other status move clears it.
- **The just-rejected bar** on the Ideas board (`justRejected`): this person's rejections from the last two minutes that
  are still rejected, read from the audit rows every reject path writes (card, key press, bulk bar — social rows now
  record `meta.from` too), so no path needs a redirect. Each row has **Undo** (`undoRejectAction`: back to `from`,
  discovered or approved, only if still rejected; audited as a restore) and the four reasons (`setRejectReasonAction`,
  only on a still-rejected idea). Rejected cards show their reason.
- **Discovery hears it**: article (`discoverIdeasCore`) and social (`discoverSocialIdeasCore`) prompts get
  `rejectedLine` — the 20 newest rejected titles with "[reason]" — as "propose nothing like them", on top of the old
  "avoid duplicating" list. Video ideas (archived, not rejected) and deleting are unchanged: a deleted idea has no undo.

## ⚠ Notifications open, filter, page and span workspaces (2026-11-01, audit Phase 5, growth part x)
- **E-SHL-08 — opening is reading**: a notification title links to `/notifications/open/[id]` (a route handler, a
  plain `<a>` so no prefetch marks anything): it marks the row read and redirects to `safeNotificationTarget(url)` —
  a path on this site only (`/…`, never `//…` or `/\…`); anything else opens `/notifications`. The row must be the
  signed-in user's, in a workspace they are still an **active** member of (a revoked or deleted one refuses with
  `?error=`). One from another of their workspaces sets the active-workspace cookie first, because `url` is a path
  inside that workspace. Email links still point straight at the thing (the email is sent before the row exists).
- **Filters and pages** live in the URL (`lib/notification-list.ts`: `parseNotificationQuery`, `notificationsHref`):
  `kind` (unknown kinds are ignored), `unread=1`, `page` (30 a page; a page past the end redirects to the last —
  in-page, since `loading.tsx` streams first). Kind chips count within the scope and the unread toggle.
- **All workspaces** (`scope=all`) exists only for someone with more than one active membership; each item carries
  its workspace and its time in **that** workspace's posting zone. The single view shows "N unread elsewhere".
  Mark read / "Mark these read" / "Clear read" act on what is shown — scope and kind — and the workspace list always
  comes from the user's own active memberships (`scopeFor` in `actions/notifications.ts`), never from the form.
  Preferences stay per workspace (the form is for the one you're in). The bell still counts the active workspace.

## ⚠ The sweep says what it will do next (2026-11-01, audit Phase 5, growth part y)
- **E-ENG-05 — one set of selectors**: `lib/sweep-plan.ts` holds what the cycle picks — `ideasToDraft` (approved ideas in
  DRAFT_ORDER, site changes skipped, two a sweep under `autopilot:weekly_articles`), `publishCandidates` (final approval,
  not live or a refresh, publish day in the posting zone, nothing without a site), `queueableDrafts` (unscheduled drafts,
  approval OR [null, "approved"], never `notIn`) and the per-sweep caps. `runAutopilotCycle` calls them; **change a pick
  here, never in a copy** — the preview exists to say exactly what the engine does.
- **"Next sweep will…"** on Settings → Automation (`previewNextSweep`, `components/NextSweepCard.tsx`): which ideas draft,
  which articles publish and which are held (by the same `blockingChecks`, stopping at the same two ready), which drafts
  get which slot (`pickFreeSlot` over the same free list, **not reserved**), and why a section does nothing (mode,
  allowance, weekly cap, no site, not the publish day, not full autonomy, pause, AUTOPILOT=off). It only reads:
  `linkRefreshTargets(…, { write: false })` works the refresh links out without saving them. The time is the last
  check-in plus the interval, "due now" once passed.

## ⚠ Articles losing clicks become refresh ideas (2026-11-01, audit Phase 5, growth part z)
- **E-MEA-15 — measured or silent** (`lib/content-decay.ts` `decayingPosts`): a published article whose clicks over the
  28 days ending at **its latest reading** (Search Console lags; never "today") are down `DECAY_DROP` (30%) or more on
  the 28 days before. Silent unless each window has click readings on `DECAY_MIN_DAYS` (21) of its days, the earlier
  window had `DECAY_MIN_PRIOR_CLICKS` (30), and the latest reading is under `DECAY_MAX_STALE_DAYS` (10) old — a patchy
  or stopped sync, or a post nobody visited, never reads as a collapse. Most clicks lost first.
- **One way to make a refresh idea** (`createRefreshIdea`): "Refresh: <title>", source refresh, linked to the post,
  Discovered; not when one exists by link or title **in any status** (a rejected one stays rejected). The engine's
  ranking loop (position > 10) and the decay loop both use it, three a cycle between them, only with ideation unattended
  and only for refreshable posts (live via WordPress or a recorded link, not protected from rewrites). The angle is the
  two windows' numbers (`decayAngle`).
- **Measure → Losing clicks**: the list with clicks, drop and position; editors get "Make a refresh idea"
  (`makeDecayRefreshIdeaAction`), which **measures again** rather than trusting the form; protected and unlinked
  articles say why there's no button; one with an idea links to it on the board. Its windows are fixed, not the picker's.

## ⚠ A teleprompter driven by words per minute and the keyboard (2026-11-01, audit Phase 5, growth part aa)
- **E-VID-02 — what it shows** (`lib/teleprompter.ts` `prompterBlocks`, run on the server): the script with markdown
  out (emphasis, code, links keep their text, images and rules go, an HTML body loses its tags). Headings show as small
  section labels and whole-line `[…]` / `(…)` lines as dim cues; **neither counts as spoken words** (`spokenWords`) —
  the speed is words per minute, and counting direction as speech would run the text ahead of the voice.
- **Speed**: pixels per second = wpm ÷ 60 × (text height ÷ spoken words), recomputed every frame, so a size change keeps
  the pace. Default 150 wpm (`WORDS_PER_MINUTE`), 60–300 in 10s. "m:ss left" and words left come from how far down
  the text the scroll is.
- **Keys** (window listener; ignored in fields, and Space on a focused button is that button's press): Space play/pause
  (a press during the countdown cancels it), ↑↓ speed, ←→ / PgUp PgDn nudge three lines, − + size, M mirror
  (`scaleX(-1)` on the text), C countdown on/off, F fullscreen (the prompter element), R / Home back to the top.
- **Reading line** at 35% of the height with the text above it fading; padding lets the first line start on it and
  the last reach it. A 3-2-1 countdown before scrolling, on by default. Preferences (wpm, size, mirror, countdown) are
  saved per browser through an external store — memory is the truth once read, so a private window still works.

## ⚠ The Articles list filters, pages and acts in bulk (2026-11-01, audit Phase 5, growth part ab)
- **E-ART-08 — filters in the URL** (`lib/article-list.ts`): `/blog?view=list` takes `status`, `topic`, `reviewer` (an id or
  `none`), `q` (title or focus keyword, case-insensitive) and `page` (50 a page; past the end goes to the last). Unknown
  values read as no filter. The status chips count within the other filters. The board view is unchanged.
- **Bulk actions** (`actions/article-bulk.ts`, one action, `op` from the pressed button) do what the article's own page
  does, article by article, with the same role: **Set reviewer** (EDITOR; an active member or none; one notice for the
  lot), **Advance what passes** (EDITOR; in review → final approval only through `advanceIfReadyCore`, so the checks — or
  an admin's override — decide; the rest are counted), **Schedule** (ADMIN; final approval only; one every N days from a
  first day and time, stepped in posting-zone wall clock), **Delete** (ADMIN; needs the confirmation box; **published
  articles are kept** — they're live with their numbers — and each deletion is audited with its title). Ids are narrowed
  to the workspace before anything; the redirect goes back to the same filtered list with what happened.
- CSV downloads the page as shown (`CsvButton` skips cells marked `data-csv-skip` — the checkbox column).

## ⚠ The Sent list shows results; top performers can be reposted or made evergreen (2026-11-01, audit Phase 5, growth part ac)
- **E-SOC-14 — results per post** (`lib/social/post-results.ts` `resultsForPosts`): impressions, engagement (likes +
  comments + shares + saves) and clicks from the **latest reading of each network** (`latestPerTarget` — readings are
  cumulative, so adding older ones would inflate them), summed across the post's networks. No reading = no result: the
  row says "not measured yet" (a failed post shows a dash), never a zero; a metric no network reported stays a dash.
- **Top performer** (`topPerformers`): posts sent in the last 90 days with an engagement reading, the best tenth (at least
  one, ties included) — none below five measured posts, and none when the bar would be zero. A chip on the row and a
  "Top performers (90 days)" filter on Sent (`type=top`, resolved to ids in `loadPostList`).
- **Repost** is the existing Duplicate (a copy to drafts, new content for approval). **Make evergreen / Stop recycling**
  (`setEvergreenAction`, EDITOR) only on a post that went out (posted or partial) and never on a recycled copy (clones are
  never sources). It says plainly when recycling is still waiting on the workspace's Evergreen fill; audited both ways.

## ⚠ The script editor has an outline: sections, retention markers, find and replace (2026-11-01, audit Phase 5, growth part ad)
- **E-VID-10** (`lib/script-outline.ts`, `scripts/[id]/ScriptOutline.tsx`, in the editor only — a viewer reads the script
  without it): **sections** split at markdown headings (the text before the first heading is a section only when
  something is said in it), each with its spoken length and where it starts; **retention markers** every 30 / 45 / 60 s
  of speech pointing at the word where that second falls; **find and replace**, literal (never a pattern), case-
  insensitive unless "Match case".
- **Time is spoken time** at `WORDS_PER_MINUTE`, counting the same words the teleprompter counts — headings and
  whole-line cues (`[…]`, `(…)`) take none — so the outline, the editor's duration-to-be and the prompter agree.
- Clicking a section, a marker or **Next** selects that place in the editor and scrolls it into view (line-based, so a
  long wrapped paragraph lands near, not exactly). **Replace all** hands the new text to the editor, which autosaves it
  like typing — no separate save path.

## ⚠ Evergreen has controls and a library (2026-11-01, audit Phase 5, growth part ae)
- **E-SOC-15 — one rule** (`lib/social/evergreen-rules.ts` `evergreenState`): off → not sent yet → **finished** (the
  cap, `SocialPost.maxRecycles`, reached) → **ended** (`recycleUntil` passed) → a copy in flight → cooling until last out
  + `recycleEveryDays` → due. The recycler takes only "due" and the Evergreen library shows the same state, so the page
  can't promise what the recycler won't do. Migration `20261101160000_evergreen_controls` (`maxRecycles`,
  `recycleVariants`).
- **Variants** (`recycleText`): the original and its variants take turns, a variant first (recycle 1 → variant 1 …, then
  the original, then round again). A copy that uses a variant drops the targets' per-network wording (the variant is
  the text everywhere); a copy of the original keeps it. The turn is recorded in the `social.recycled` audit meta.
- **Distribute → Evergreen** (`/social/evergreen`): every evergreen source (not copies) with its state, count and cap,
  end date, last copy, and what it and its copies have earned (`resultsForPosts` over source + copies). Editors get
  **Settings** (`saveEvergreenSettingsAction`: every 1–365 days, until a day — the end of that day in the posting zone —,
  at most 1–1000 or no limit, variants separated by a `---` line, at most 10) and **Stop recycling**. It says plainly when
  Evergreen fill is off. `listBack` allows `/social/evergreen`.

## ⚠ Duplicate ideas are flagged across formats and can be merged (2026-11-01, audit Phase 5, growth part af)
- **E-IDE-03 — one index** (`lib/idea-duplicates.ts` `openWorkIndex`): the workspace's open article, video and social
  ideas, articles being written (drafting → final approval) and draft scripts, compared on the meaningful words of the
  title (`keyTokens` Jaccard, the idea scoring's own measure); `DUP_THRESHOLD` 0.5. It only points — nothing is merged,
  hidden or held without a person.
- **The board**: an open idea with close open work shows "Looks like the <kind> …, N% the same words" with a link
  (ties go to work further along — a draft beats an idea). Two ideas of the **same kind** get **Merge into it**:
  articles through their existing merge (`mergeBlogIdeasAction`), social and video through `mergeDuplicateIdeaAction`
  (EDITOR, both open): the kept one gains the other's angle / strategy; the social one folded in is **rejected as
  "duplicate"** (so discovery steers away from it), the video one **archived** (never one in progress); audited
  `ideas.merged`. Cross-kind and draft matches are pointers only.
- **Research and Intel rows** (`ResearchIdeaForm` `already`): "Already made into …" when an idea keeps this video as its
  source (`sourceVideoId`, any format), else "Already close to …" for close open work. Shown, never blocking — making
  another is still a person's call. Editors only (it's beside the button that makes one).

## ⚠ Each article has a Performance tab (2026-11-01, audit Phase 5, growth part ag)
- **E-MEA-06** (`blog/[id]/ArticlePerformance.tsx`, the article's Performance tab, any member): clicks, impressions, CTR
  and impression-weighted position for the 28 days to **its latest reading** against the 28 before (as on Measure — never
  "today"), with the change (position: lower is better); daily clicks and impressions for up to 90 readings (a day with no
  reading is drawn at zero and said to be unmeasured).
- **Top queries are not shown**: Search Console's per-query numbers aren't synced, and the tab says so instead of guessing
  them from the focus keyword. Rank tracking (E-MEA-08) is what would fill it.
- **Social posts that pointed here**: posts made from the article's social ideas (`SocialIdea.sourceBlogPostId` →
  `socialPostId`) plus any post whose text carries its `publishedUrl`, each with `resultsForPosts` numbers and the clicks
  total — "not measured yet" when a sent post has no reading.

## ⚠ Readability coaching per section (2026-11-01, audit Phase 5, growth part ah)
- **E-ART-11** (`lib/readability.ts`, `blog/[id]/ReadabilityCoach.tsx` on the Optimize tab): the body (HTML or markdown)
  split at its H2/H3 headings; each section's Flesch reading ease against the article's `readingLevel` (simple 60+,
  standard 50+, advanced 30+; unset → standard, and it says so), with **long sentences** (over 20 / 25 / 30 words),
  **long paragraphs** (over 90 / 120 / 150) and **passive voice** (a form of "to be" + a past participle — a heuristic,
  and the card says it can miss some or catch a false one), the passive phrase highlighted. A section too short to score
  shows "too short to score", never a number.
- **Advisory only**: it never gates a publish and never edits the text — like the readability check beside it.

## ⚠ Each campaign has its own page (2026-11-01, audit Phase 5, growth part ai)
- **E-SOC-21** (`/social/campaigns/[id]`, any member, this workspace's campaigns only — else 404): counts by state
  (drafts, scheduled, sent, partly sent, failed); a six-week calendar in the posting zone (two weeks back, four ahead,
  today marked, each day's posts as chips coloured by state, undated drafts counted beneath); **by network** —
  `byNetwork(latestPerTarget(...))` over this campaign's snapshots, so the latest reading per post per network, summed,
  with a total row and a dash where nothing was measured; and its best posts by engagement (`resultsForPosts`).
- Reached from the campaign name on Settings → Schedule and on a post row in Queue / Sent / Drafts (`listInclude`
  carries the campaign id).

## ⚠ Ideas have detail pages (2026-11-01, audit Phase 5, growth part aj)
- **E-IDE-16**: `/ideas/article/[id]` is now readable by **every member** (the Tags and Merge forms stay editors'), and
  social ideas get `/ideas/social/[id]` (new). Both show what the idea is and where it came from (the research video, the
  article whose angle it is, the feed link), its Topic, its priority with the lines the scoring wrote (`priorityReason`;
  social ideas store none and say so), the post it became, what it was merged into, and its **history**
  (`lib/idea-history.ts`: the audit rows its actions already write — approved, rejected, not yet, restored, merged in /
  into, made from a finding or from Losing clicks — oldest first, with who; "the engine" where nobody acted).
- Social page: editors get Approve / Reject / Not yet / Restore (the board's `setSocialIdeaStatusAction`) and an edit form
  (`updateSocialIdeaAction`); a drafted idea points editing at its post. Board card titles link to these pages, and the
  duplicate flags (part af) point social matches at them.

## ⚠ Search anomalies reach the Inbox and the digest (2026-11-01, audit Phase 5, growth part ak)
- **E-MEA-19** (`lib/search-anomalies.ts`, added to `getHomeData`'s decisions, so they show in the Inbox and make the
  morning digest send): **search clicks falling week on week** — the workspace's published articles, the 7 days to the
  **latest reading** against the 7 before, warn at a 30% drop; and **articles falling off page one** — impression-
  weighted position ≤ 10 the week before and > 10 now. One item per article up to three, then one summary item (biggest
  first, by impressions).
- **Silent on thin or stale data**: each week needs click readings on 5+ days, the earlier week 50+ clicks, an article
  30+ impressions in each week, and the latest reading under 10 days old — an alarm that fires on noise teaches people to
  ignore it. Failing analytics syncs were already their own warn item (MEA-06) and are unchanged.

## ⚠ Social CSV import: template, dry run, timezone and media (2026-11-01, audit Phase 5, growth part al)
- **E-SOC-16 — one planner** (`lib/social/csv-import.ts` `planImport`): every row checked and turned into the post it
  would create or the reason it can't; **"Check the file"** runs it and writes nothing, **"Import"** creates the rows that
  pass and skips the rest — so the check can't disagree with the import. Both return row-by-row results to the page
  (`components/SocialCsvImport.tsx`, `useActionState`; the action returns, it doesn't redirect).
- **Columns**: text (required) · scheduledAt · **timezone** (an IANA zone for that row's date; unknown → row error; empty
  → the posting zone) · networks · campaign · category · evergreen · recycleEveryDays · **media** (media-library items by
  name or key, `|`-separated, up to 4; unknown → row error). With media, image-only networks are kept; video-only
  networks need a video item; without media they're skipped with a note, as before. Unknown campaigns stay row errors.
- **Row numbers are the spreadsheet's**: blank rows are kept by the parser for numbering and skipped by the planner.
- **Template** (`/api/social/import-template`, any member): every column with two example rows written for the
  workspace — its networks, posting zone, a campaign and a media item when it has them.

## ⚠ Keywords edit in place and in bulk; ideas from keywords get real titles (2026-11-01, audit Phase 5, growth part am)
- **Each keyword row edits in place** (E-IDE-13): an Edit fold under the phrase sets tier, intent and cluster
  through `updateKeywordAction`, keeping the row's status. A person's intent replaces the AI's. Viewers get no Edit.
- **One bulk bar spans every cluster's table**: the row boxes carry `form="kw-bulk"` so they join one form across
  sections, and `SelectAllBox` takes a `formId` to tick them. `bulkKeywordsAction` (editors) narrows the ticked ids
  to this workspace before it writes, then moves to a cluster (blank = none), sets the tier (1–4 only), pauses,
  resumes, or deletes — delete needs the confirm box — and redirects with what it did. **Move is the bar's first
  button** on purpose: Enter in the cluster field submits the first button, and that must not be Pause or Delete.
- **An idea from a keyword gets a working title, not "Article targeting …"**: `lib/keyword-title.ts`
  (`proposeKeywordTitle`, no model — instant, free, never a mock) shapes it by the phrase (how-to, question,
  comparison) and the keyword's intent; a commercial phrase already starting "best"/"top" isn't doubled. The idea is
  filed under the Topic named like the cluster (case-insensitive), else the one `matchTopic` finds in the phrase,
  else none — and the message says which. It carries the keyword's tier.
- **No second idea for a keyword**: an open (discovered or approved) idea with the same keyword refuses the button
  and names that idea.
- Inputs and selects on this page have the visible border (`border border-[var(--line-2)] rounded-lg`) — the add
  form and the country picker had none.

## ⚠ RSS feeds filter by words, take the article's picture, and target default accounts (2026-11-01, audit Phase 5, growth part an)
- **Include and exclude words per feed** (E-SOC-20, `lib/social/rss-filter.ts`, migration `20261101180000_rss_filters`):
  phrases split on commas or lines, stored lowercased as one line, matched as **whole words** in the title and summary.
  An exclude match always wins; with include words set, an item needs one of them. The filter runs **before** the
  first-read (5 from the last week) and per-poll (10) caps, so skipped items never use up places. A skipped item is still
  recorded as seen, with `RssItem.skipped` saying why, and the page lists it as "skipped — …". Follow and Check now
  say how many were skipped.
- **Drafts can take the article's picture** (`useImage`, drafts mode only, `lib/social/rss-image.ts`): the feed's own image
  first (media:content / media:thumbnail / an image enclosure / the first `<img>`), else the linked page's og:image or
  twitter:image. Fetched through `safeFetch` (the feed's private-network guard), kept only as PNG/JPEG/GIF/WebP under
  8 MB, stored with the workspace as owner and added to the media library. **One 25 s budget per poll** covers every
  picture, so a slow site can't hold the sweep or the Follow button. Any failure means no picture — never a failed item.
- **Default accounts for drafts** (`accountIds`, ZernioAccount row ids): narrowed to this workspace's connected accounts
  when saved, and again when a draft is made. A network that needs a picture is left off a draft without one, and a
  video-only network is never targeted — the same rule as the CSV import, so no draft carries a target that can't send.
- **192.0.x.x is public except 192.0.0.0/24 and 192.0.2.0/24** (`lib/net/public-host.ts`). The guard used to refuse the
  whole /16 as "IETF protocol assignments", but 192.0.64.0/18 is Automattic — so every feed on WordPress.com or WordPress
  VIP (github.blog, …) was refused as "a private address". Never widen a reserved range past its real prefix; check a
  real host in it before shipping a new one.
- The feed line says what its rules do ("only items mentioning … · never … · drafts take the article's picture · drafts
  go to …"); the fields sit in a "Filters and defaults" fold, open when the feed has any. Viewers see neither.

## ⚠ Article versions say who made them and can be compared before a restore (2026-11-02, audit Phase 5, growth part ao)
- **Every version records its actor** (E-ART-03, `BlogPostVersion.actorId`, migration `20261101190000_version_actor`): all
  seven writers pass it — saves and edit conflicts, restores, section rewrites, FAQ and key takeaways, applied findings
  (`opts.actorId`), and generation (`brief.actorId`). Null means the engine, or auto-review for "before finding" rows.
  `lib/version-actor.ts` names them; rows written **before the migration** (its `_prisma_migrations.finished_at`) say
  "not recorded" — a person's save then looked the same as the engine's, so it never guesses. A new version writer must
  pass the actor.
- **`/blog/[id]/versions` compares any two versions, or one against the current text** (`lib/text-diff.ts`, no library):
  the HTML as blocks (headings, paragraphs, list items…; images as "[image: alt]"), matched by LCS, then a word diff of
  each edited pair; pairs only when they share ≥40% of words, else a removal and an addition. Long unchanged runs fold.
  The tables are capped (4M block cells, 400K word cells) — past that a block or pair shows as replaced whole. Side by
  side on desktop; stacked with Before/After labels on phones. Viewers can compare; Restore is for editors and only
  when the version differs from the current text.
- **Restore from the compare page answers there** (`back=versions`): "Restored “…”. The text it replaced is kept as
  “before restore” — compared below", and the default compare then shows exactly what the restore changed.
- **The palette's red is `--rose-*`; there is no `--red-*`.** Undefined tokens fail silently (the Keywords error banner,
  falling-trend arrows and "high" competition pills were uncoloured; Elsie's tooltip arrow fell back to white on dark
  cards). `--card` is now a token (white; `--bg` in both dark modes, as `.card` paints). **`scripts/check-css-vars.mts`
  runs in prebuild** and fails the build on a static `var(--x)` that no CSS file, style object or next/font defines
  (a `var()` with its own fallback is allowed; dynamic `var(--${hue}-…)` names can't be checked — use real hues).

## ⚠ Articles preview their Google result and social cards as the fields are typed (2026-11-02, audit Phase 5, growth part ap)
- **The Google result is cut by width, not characters** (E-ART-06, `lib/serp-preview.ts`, import-free so it runs in the
  browser): about 600px of a 20px title and 920px of a 14px description, measured with Arial/Helvetica advance widths
  (other characters count as an average letter), cut at a whole word with " ...". The page calls it an estimate and
  Google may rewrite a title — never present the cut as Google's own. With no meta title the article title shows; with
  no meta description the opening paragraph (headings skipped) shows **in italics**, labelled as Google's pick.
- **Cards follow the export's image rule**: the approved OG image, else the approved featured one; none → a text-only
  card, said so. A card image far from 1.91:1 is flagged as cropped. OG title/description fall back to the meta pair.
- **`SearchSocialPreview` reads its own form's fields** (`title`, `slug`, `metaTitle`, `metaDescription`, `ogTitle`,
  `ogDescription`) through one `input` listener on the closest form — so it sits inside the settings form and saves
  nothing. The breadcrumb host is the WordPress connection's address, else the published URL's origin, else a placeholder.

## ⚠ Automation shows a week of engine cycles, quiet runs folded and silences marked (2026-11-02, audit Phase 5, growth part aq)
- **Every cycle that runs writes an `EngineCycle` row** (E-ENG-04, migration `20261102010000_engine_cycles`,
  `recordCycle` in `lib/engine-timeline.ts`, called from `runAutopilotCycle` beside the check-in) — quiet and paused
  ones too; the counts and failed steps are kept as JSON only when there's something to say. Rows older than 7 days are
  pruned on the next write; the table cascades with the workspace. Busy (locked) cycles didn't run and write nothing.
  Don't use the audit log for this: it only records cycles that did something, so it can't tell quiet from not running.
- **`timeline()` folds** consecutive quiet, paused or allowance-spent runs into one item, keeps any cycle that did
  something or failed on its own line (counts in words, each failed step with its message), and marks a **gap** where two
  check-ins are more than twice the sweep interval apart — a dead sweep, not a quiet hour. The summary counts cycles,
  ones that did something (a failure alone doesn't count), failures and gaps.
- Settings → Automation shows it as "Engine activity — the last 7 days" under the next-sweep card, day headers in the
  posting zone, newest 120 items. Everyone can read it; it changes nothing.
