import { Suspense } from "react";
import Link from "next/link";
import { LogOut, Layers, User } from "lucide-react";
import { unreadCount } from "@/lib/notify";
import { BrandLogo } from "@/components/BrandLogo";
import { EngineStatus } from "@/components/EngineStatus";
import { AccountMenu } from "@/components/AccountMenu";
import { tickerEvents } from "@/lib/dashboard-data";
import { isGloballyPaused } from "@/lib/governance";
import { isFullyAutonomous } from "@/lib/autonomy";
import { readHeartbeat } from "@/lib/engine-heartbeat";
import { signOut } from "@/auth";
import { getActiveChannel } from "@/lib/channel";
import { isPlatformOperator, canEdit } from "@/lib/acl";
import { LeftRailNav } from "@/components/LeftRailNav";
import { RAIL } from "@/lib/nav";
import { MobileNav } from "@/components/MobileNav";
import { studioState } from "@/lib/studio";
import { stripCounts } from "@/lib/stage-counts";
import { getPostingTimeZone } from "@/lib/social/slots";
import { StageStrip } from "@/components/StageStrip";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { workspaceBadges } from "@/lib/workspace-badges";
import { setActiveWorkspaceAction } from "@/app/actions/workspace-switch";
import { storage } from "@/lib/storage";
import { db } from "@/lib/db";
import { Elsie } from "@/components/Elsie";
import { MobileTabBar } from "@/components/MobileTabBar";
import { cookies } from "next/headers";
import { setTabBarAction } from "@/app/actions/shell-prefs";
import { setGuideEnabledAction } from "@/app/actions/guide";
import { AiActivity } from "@/components/AiActivity";
import { ShellPoll } from "@/components/ShellPoll";
import { UnreadBell } from "@/components/UnreadBell";
import { WorkspaceGuard } from "@/components/WorkspaceGuard";
import { AssistantDock, AssistantDockButton } from "@/components/AssistantDock";
import { FlashBanner } from "@/components/FlashBanner";
import { getGuideState } from "@/app/actions/guide";
import { relevantSteps, outstandingSetup, availableTracks, type SetupState } from "@/lib/guide/steps";
import { BRAND, PRODUCT, PRODUCT_SHORT } from "@/lib/product";
import { currentIncident } from "@/lib/incident";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { SUPPORT_MEMBERSHIP_ID, activeSupportView } from "@/lib/support-view";
import { endSupportViewAction } from "@/app/actions/platform-workspaces";



/** Two letters for the avatar: "Idris Grant" → IG, "pat@x.com" → PA. */
function initialsOf(nameOrEmail: string): string {
  const words = nameOrEmail.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, membership, channels, active } = await getActiveChannel();
  const userLabel = user.name ?? user.email.split("@")[0];
  const editorUp = canEdit(membership.role);
  const navItems = RAIL.filter((n) => (!n.adminOnly || membership.role === "ADMIN") && (!n.editorOnly || editorUp));
  const activeChoices = user.memberships
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.workspaceId, name: m.workspace.name }));
  // E-SHL-05: what needs this person in each OTHER workspace, for the switcher.
  const badges = activeChoices.length > 1
    ? await workspaceBadges(user.id, activeChoices.filter((w) => w.id !== workspace.id).map((w) => w.id)).catch(() => new Map())
    : new Map();
  const workspaceChoices = activeChoices.map((w) => ({ ...w, badge: badges.get(w.id) ?? null }));
  // Creating a workspace stands up a whole tenant, so it's the platform
  // operator's job, not a workspace admin's. Cosmetic only — the action
  // enforces the same check.
  const canCreateWorkspace = isPlatformOperator(user.email);

  // Per-company branding (multi-tenant): accent re-tints the chrome via CSS
  // token overrides; the logo/wordmark swap to the company's own. Hex is
  // re-validated here — never interpolate an unvalidated DB string into CSS.
  const accent = workspace.accentColor && /^#[0-9a-fA-F]{6}$/.test(workspace.accentColor) ? workspace.accentColor : null;
  const logoUrl = workspace.logoKey ? storage.url(workspace.logoKey) : null;
  // ⚠ CO-BRANDED, NOT WHITE-LABELLED. This used to be a straight swap — set an
  // accent or upload a logo and every trace of MeYouSocial disappeared from the
  // chrome. The tenant's identity should lead, but the product it runs on
  // shouldn't vanish: `isBranded` drives a byline that keeps both visible.
  const isBranded = Boolean(accent || logoUrl);
  const brandName = isBranded ? workspace.name : BRAND;
  // The byline under the wordmark: the product. A branded install shows the
  // full product name under the tenant's; an unbranded one already says the
  // family brand above, so just the product word.
  const byline = isBranded ? PRODUCT : PRODUCT_SHORT;
  // The alias tokens (--accent*, --brand-on…) capture :root's --brand at
  // definition time, so every derived token must be restated here, per theme.
  const brandCss = accent ? `
.ws-brand {
  --brand: ${accent};
  --brand-2: color-mix(in srgb, ${accent} 72%, black);
  --brand-soft: color-mix(in srgb, ${accent} 12%, white);
  --brand-on: ${accent};
  --accent: ${accent};
  --accent-soft: color-mix(in srgb, ${accent} 12%, white);
  --accent-strong: color-mix(in srgb, ${accent} 72%, black);
  --accent-on: ${accent};
}
html[data-theme="dark"] .ws-brand {
  --brand-soft: color-mix(in srgb, ${accent} 18%, var(--bg));
  --accent-soft: color-mix(in srgb, ${accent} 18%, var(--bg));
  --brand-on: color-mix(in srgb, ${accent} 62%, white);
  --accent-on: color-mix(in srgb, ${accent} 62%, white);
}
@media (prefers-color-scheme: dark) {
  html[data-theme="auto"] .ws-brand {
    --brand-soft: color-mix(in srgb, ${accent} 18%, var(--bg));
    --accent-soft: color-mix(in srgb, ${accent} 18%, var(--bg));
    --brand-on: color-mix(in srgb, ${accent} 62%, white);
    --accent-on: color-mix(in srgb, ${accent} 62%, white);
  }
}` : null;
  const [unread, ticker, studio, counts, tickerZone, enginePaused, engineAutonomous, heartbeat, incident] = await Promise.all([
    unreadCount(workspace.id, user.id),
    tickerEvents(workspace.id, 12),
    // Whether the video studio's tabs show (lib/studio.ts) and the strip's
    // count badges (lib/stage-counts.ts) — read once here because the strip
    // is in the shell.
    studioState(workspace.id),
    stripCounts(workspace.id),
    // The pill formats times in this zone on both server and client (see
    // EngineStatus) — the workspace's posting zone, UTC when none is set.
    getPostingTimeZone(workspace.id).catch(() => "UTC"),
    // Both are 30s-cached setting reads (lib/settings.ts), so the pill can say
    // "Paused" or "Running on its own" without a second trip.
    isGloballyPaused(workspace.id),
    isFullyAutonomous(workspace.id),
    // The engine's last check-in (E-ENG-03), so an idle engine and a stopped one differ.
    readHeartbeat(workspace.id).catch(() => null),
    // An incident the operator declared (E-SEC-06) — a 30s-cached platform setting.
    membership.role === "ADMIN" ? currentIncident() : Promise.resolve(null),
  ]);
  // E-SET-10: a support view of this workspace — the operator's own (synthetic
  // membership) or, for its members, the operator looking in.
  const supportSelf = membership.id === SUPPORT_MEMBERSHIP_ID;
  const supportView = await activeSupportView(workspace.id).catch(() => null);

  const engineState = { paused: enginePaused, autonomous: engineAutonomous, heartbeat, autopilotOff: process.env.AUTOPILOT === "off" };

  // Elsie, the guide. Her setup steps are filtered against what this workspace
  // has actually done, so she never walks anyone through work already finished.
  // All counts, deliberately — cheap enough to run on every page render.
  const guide = await getGuideState();
  // E-SHL-10: the phone's bottom tabs, unless this browser turned them off.
  const tabBar = (await cookies()).get("mys_tabbar")?.value !== "off";
  const [llmKeyRows, wsLlmKeyRows, zernioKeyRow, socialAccounts, emailAccounts, topics, postingSlots, blogPosts, storageBackend, analyticsRows] = await Promise.all([
    db.setting.count({ where: { key: { in: ["api_key:anthropic", "api_key:google"] }, NOT: { value: "" } } }),
    // ⚠ Workspace keys count too. This only looked at PLATFORM settings, so a
    // company that had pasted its own key was still told to "add an AI provider
    // key" — the guide nagging about work already done is precisely what makes
    // people close it.
    db.workspaceSetting.count({ where: { workspaceId: workspace.id, key: { in: ["api_key:anthropic", "api_key:google"] }, NOT: { value: "" } } }),
    db.setting.findFirst({ where: { key: "zernio:api_key", NOT: { value: "" } }, select: { key: true } }),
    db.zernioAccount.count({ where: { workspaceId: workspace.id, status: "connected" } }),
    db.unipileAccount.count({ where: { workspaceId: workspace.id, kind: "email", status: "connected" } }),
    db.topic.count({ where: { workspaceId: workspace.id } }),
    db.postingSlot.count({ where: { workspaceId: workspace.id } }),
    db.blogPost.count({ where: { workspaceId: workspace.id } }),
    db.setting.findUnique({ where: { key: "storage:backend" }, select: { value: true } }),
    db.workspaceSetting.count({
      where: { workspaceId: workspace.id, key: { in: ["gsc:site_url", "ga4:property_id", "youtube_oauth:refresh_token"] }, NOT: { value: "" } },
    }),
  ]);
  const setupState: SetupState = {
    hasLlmKey: llmKeyRows > 0 || wsLlmKeyRows > 0 || Boolean(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENAI_API_KEY),
    // A model is chosen if the workspace picked one or any channel did.
    defaultModelSet: Boolean(workspace.defaultModel) || channels.some((c) => c.defaultModel),
    channelLinked: channels.some((c) => c.linkedYoutubeId),
    storageDurable: storageBackend?.value === "gdrive",
    analyticsConnected: analyticsRows > 0,
    socialConfigured: Boolean(zernioKeyRow) || Boolean(process.env.ZERNIO_API_KEY),
    socialAccounts,
    emailConnected: emailAccounts > 0,
    topics,
    postingSlots,
    blogPosts,
    isOperator: canCreateWorkspace,
    // Who is looking, and what they can see (SHL-08): setup steps and admin
    // pages are an admin's, rail anchors must be on THIS rail, and studio steps
    // wait for the studio.
    role: membership.role,
    rail: navItems.map((n) => `nav${n.href}`),
    studio: studio.on,
  };
  // `needed` is a function and can't cross to the client — strip it. Tracks are
  // resolved server-side for the same reason: the picker needs real step lists,
  // not predicates it can't run.
  const strip = (list: ReturnType<typeof relevantSteps>) => list.map(({ needed: _needed, ...s }) => s);
  const elsieSteps = strip(relevantSteps(setupState, guide.done));
  const elsieOutstanding = outstandingSetup(setupState, guide.done);
  const elsieTracks = availableTracks(setupState, guide.done).map((t) => ({
    id: t.id, label: t.label, blurb: t.blurb, steps: strip(t.steps),
  }));

  return (
    // @container: the rail + header adapt to EFFECTIVE width (container queries
    // measure the zoom-scaled space, viewport breakpoints don't — the XL
    // content-size setting shrinks effective width ~18% without moving any
    // media query). Below ~72rem effective the rail collapses to icons.
    <div className={"flex-1 flex min-h-screen @container" + (brandCss ? " ws-brand" : "")}>
      {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      {/* max-h + overflow-y-auto: the rail's intrinsic height (~980px with all
          16 modules) exceeds shorter viewports — 1080p at 125% Windows scaling,
          or any browser zoom. Without the cap its content spills past the shell,
          the WINDOW grows a scrollbar, and scrolling clips the (non-sticky)
          header — the "truncated page with the rail extending past the content"
          reported from screenshots on 2026-08-01 and 08-03. The shell's scroll
          container is <main>; the window must never scroll. 100vh is divided by
          --ui-zoom for the same reason .min-h-screen is (see globals.css). */}
      <aside className="w-[68px] @6xl:w-64 left-rail border-r border-[var(--line)] hidden md:flex flex-col gap-1 py-4 px-2 @6xl:px-3 flex-shrink-0 sticky top-0 max-h-[calc(100vh/var(--ui-zoom))] overflow-y-auto overscroll-contain z-40 transition-[width] duration-200 motion-reduce:transition-none">
        <Link
          href="/inbox"
          className="flex items-center justify-center @6xl:justify-start gap-2.5 px-0 @6xl:px-2 py-1.5 mb-2 rounded-xl"
          title={isBranded ? `${workspace.name} on ${PRODUCT} · Inbox` : `${PRODUCT} · Inbox`}
        >
          <span className="flex-shrink-0 shadow-lg shadow-[#15181D]/25 rounded-xl">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${workspace.name} logo`} width={38} height={38} className="w-[38px] h-[38px] rounded-xl object-cover" />
            ) : (
              <BrandLogo size={38} />
            )}
          </span>
          <span className="hidden @6xl:flex flex-col min-w-0">
            <span className="font-mono font-bold text-[17px] tracking-tight truncate max-w-[160px] leading-tight">{brandName}</span>
            {/* The product byline — "Publisher" under the family wordmark, or the
                full product name under a tenant's own name. Hidden with the
                wordmark when the rail collapses to icons; there is no room. */}
            <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] leading-tight mt-0.5">
              {isBranded && <BrandLogo size={11} />} {byline}
            </span>
          </span>
        </Link>

        <span data-elsie="rail" className="contents"><LeftRailNav items={navItems} /></span>

        {/* Profile + sign out */}
        <div className="mt-auto flex flex-col gap-1 pt-2 border-t border-[var(--line)]">
          <Link
            href="/settings"
            className="flex items-center justify-center @6xl:justify-start gap-3 px-0 @6xl:px-3 py-2 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--slate)] hover:bg-[var(--zebra)] transition-colors"
            aria-label={`Open ${userLabel}'s settings`}
            title={`${userLabel} · Settings`}
          >
            <span
              className="w-7 h-7 rounded-lg text-white grid place-items-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#E5482F,#6D28D9)" }}
              aria-hidden
            >
              <User className="w-[16px] h-[16px]" strokeWidth={2.25} />
            </span>
            <span className="truncate hidden @6xl:inline">{userLabel}</span>
          </Link>
          <form action={signOutAction}>
            <button
              title="Sign out"
              className="w-full flex items-center justify-center @6xl:justify-start gap-3 px-0 @6xl:px-3 py-2 rounded-xl text-sm font-semibold min-h-[44px] text-[var(--mute)] hover:text-[var(--brand)] hover:bg-[var(--brand-soft)] transition-colors"
            >
              <LogOut className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={2.25} />
              <span className="hidden @6xl:inline">Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="min-h-[60px] border-b border-[var(--line)] app-header flex items-center gap-2 md:gap-3 px-3 md:px-6 py-2 flex-shrink-0 flex-wrap">
          <div className="md:hidden">
            <MobileNav items={navItems} userLabel={userLabel} signOutAction={signOutAction} logoUrl={logoUrl} brandName={brandName} coBranded={isBranded}
              // E-SHL-10: on a phone the header keeps Ask, the bell and the avatar; the engine
              // pill, Elsie and the tab bar's switch live here.
              extra={
                <div className="flex flex-col gap-2 mb-3" data-drawer-extra>
                  <EngineStatus key={`m-${workspace.id}`} initial={ticker} timeZone={tickerZone} state={engineState} inDrawer />
                  <div className="flex flex-wrap gap-1.5">
                    {guide.enabled && (
                      <button type="button" data-drawer-elsie className="btn sm" data-open-elsie>Open the guided tour</button>
                    )}
                    <form action={setGuideEnabledAction}>
                      <input type="hidden" name="on" value={guide.enabled ? "0" : "1"} />
                      <button className="btn sm">{guide.enabled ? "Turn Elsie off" : "Turn Elsie on"}</button>
                    </form>
                    <form action={setTabBarAction}>
                      <input type="hidden" name="on" value={tabBar ? "0" : "1"} />
                      <button className="btn sm" data-tabbar-toggle>{tabBar ? "Hide the bottom tabs" : "Show the bottom tabs"}</button>
                    </form>
                  </div>
                </div>
              } />
          </div>
          {workspaceChoices.length > 1 || canCreateWorkspace ? (
            // Multi-company user: the workspace name becomes a switcher. The
            // platform operator gets it even with one workspace, because that's
            // where "+ New workspace" lives.
            <form action={setActiveWorkspaceAction} className="min-w-0">
              <WorkspaceSwitcher
                workspaces={workspaceChoices}
                activeId={workspace.id}
                canCreate={canCreateWorkspace}
              />
            </form>
          ) : (
            <Link href="/channels" className="font-mono font-bold text-[15px] tracking-tight hover:text-[var(--accent)] transition truncate max-w-[40vw] md:max-w-[200px] @6xl:max-w-none" title="Manage workspace channels">
              {workspace.name}
            </Link>
          )}
          {/* The header channel switcher is gone (One-Loop step 6): it claimed an
              "active channel" on pages that had nothing to do with one. It lives
              on the channel pages' own header now. */}
          {/* Priority order under shrinking effective width: ticker and email
              drop first, then the redundant buttons ("Manage channels" repeats
              the workspace-name link; "+ Channel" lives on /channels too). */}
          {/* !hidden: .btn is unlayered CSS (display:inline-flex) and beats the
              layered hidden utility — these two buttons were visible at EVERY
              width since the header shipped, part of the reported crowding. */}
          {/* Creating a channel is an editor's (onboarding/channel/new) — SHL-07. */}
          {editorUp && studio.show && (
            <Link href="/onboarding/channel/new" className="btn !hidden @4xl:!inline-flex items-center gap-1.5" title="Create a new YouTube channel">
              <Layers className="w-4 h-4" /> + Channel
            </Link>
          )}
          {/* @min-[88rem]: the 1024-1400 header is otherwise FULL — the ticker
              (which the user wants wide) only gets space these two give up;
              this link duplicates the workspace-name link anyway. */}
          <Link href="/channels" className="btn !hidden @min-[88rem]:!inline-flex" title="Manage all channels">Manage channels</Link>
          {/* Keyed by workspace: a switch remounts it, so the last company's
              events don't linger until the next poll (ENG-19). */}
          <div className="hidden md:contents">
            <EngineStatus key={workspace.id} initial={ticker} timeZone={tickerZone} state={engineState} />
          </div>
          <div className="flex-1" />
          {/* Viewers too — theirs only looks things up (E-ENG-15). */}
          <AssistantDockButton phone={tabBar} />
          <AiActivity />
          <Elsie steps={elsieSteps} tracks={elsieTracks} enabled={guide.enabled} outstanding={elsieOutstanding} snoozed={guide.snoozed} resumeAt={guide.at} />
          <UnreadBell initial={unread} />
          {/* The header's one poll (E-SHL-01): the pill, the bell and the strip's badges read it. */}
          <ShellPoll initial={{ workspaceId: workspace.id, events: ticker, state: engineState, unread, counts }} />
          {/* A switch in another tab makes this page stale — saving would go to the other company (E-SEC-13). */}
          <WorkspaceGuard name={workspace.name} />
          {/* Role, email, settings and sign-out behind the avatar (E-SHL-04). */}
          <AccountMenu
            initials={initialsOf(user.name ?? user.email)}
            name={user.name ?? user.email.split("@")[0]}
            email={user.email}
            role={membership.role}
            workspaceName={workspace.name}
            signOutAction={signOutAction}
          />
        </header>

        {/* The pause, on every page (E-ENG-14): the pill said "Paused" in grey type
            at one width; a person working elsewhere in the app couldn't tell. */}
        {enginePaused && (
          <div role="status" className="px-4 py-2 text-xs font-semibold flex items-center gap-2 flex-wrap" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            <span>Everything is paused — nothing is written, sent or published until it&apos;s resumed.</span>
            {membership.role === "ADMIN"
              ? <Link href="/setup/automation" className="underline">Resume on Automation</Link>
              : <span className="font-normal">An admin can resume it on Automation.</span>}
          </div>
        )}

        {/* The operator's account can reach every tenant; it should have two-factor on (E-SEC-07). */}
        {canCreateWorkspace && !user.totpEnabledAt && (
          <div role="status" className="px-4 py-2 text-xs flex items-center gap-2 flex-wrap" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
            <b>Your platform-operator account signs in with a password alone.</b>
            <Link href="/account/two-factor" className="underline">Turn on two-factor sign-in</Link>
          </div>
        )}

        {/* Read-only support view (E-SET-10): the operator's banner, and the line its members see. */}
        {supportSelf && (
          <div role="status" className="px-4 py-2 text-xs flex items-center gap-2 flex-wrap" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }} data-support-self>
            <b>Support view of {workspace.name}:</b>
            <span>you see it as a viewer and nothing here can be changed{supportView ? ` — until ${formatZonedMoment(new Date(supportView.until), tickerZone)}` : ""}.</span>
            <form action={endSupportViewAction}><button className="underline">End the support view</button></form>
          </div>
        )}
        {!supportSelf && supportView && (
          <div role="status" className="px-4 py-2 text-xs flex items-center gap-2 flex-wrap" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }} data-support-visible>
            <span>The platform operator ({supportView.email}) is looking at this workspace read-only, for support, until {formatZonedMoment(new Date(supportView.until), tickerZone)}.</span>
          </div>
        )}

        {/* A declared incident, for admins of every workspace (E-SEC-06). */}
        {incident && (
          <div role="alert" className="px-4 py-2 text-xs flex items-center gap-2 flex-wrap" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            <b>Security incident, declared by the platform operator:</b>
            <span>{incident.note}</span>
            <Link href="/admin/api-keys#rotation" className="underline">Replace your keys</Link>
            <Link href="/setup/people" className="underline">Check People</Link>
            {canCreateWorkspace && <Link href="/admin/incident" className="underline">Incident mode</Link>}
          </div>
        )}

        {/* Also a @container: page components size against the CONTENT area
            (shell minus rail), the width that actually constrains them. */}
        {/* Suspense: FlashBanner reads useSearchParams, which Next requires be
            suspended so a page can still be prerendered around it. */}
        {/* With the bottom tabs, a phone keeps room for them under the page. */}
        <main className={"flex-1 overflow-auto bg-[var(--panel)] p-6 @container" + (tabBar ? " max-md:pb-24" : "")}>
          {/* The persistent stage strip: Overview + the stage's tabs on every
              page a stage owns, so entering a tab never loses the tabs. */}
          <StageStrip
            activeChannelId={active?.id ?? null}
            studio={studio.show}
            counts={counts}
            admin={membership.role === "ADMIN"}
            operator={canCreateWorkspace}
            role={membership.role}
          />
          <Suspense fallback={null}><FlashBanner /></Suspense>
          {children}
        </main>
        {/* Keyed by workspace and scoped to the person: a switch starts on that
            workspace's own conversation (ENG-18). */}
        <AssistantDock key={workspace.id} activeChannelId={active?.id ?? null} workspaceId={workspace.id} userId={user.id} readOnly={!editorUp} floatingButton={!tabBar} />
        {tabBar && <MobileTabBar counts={counts} />}
      </div>
    </div>
  );
}

