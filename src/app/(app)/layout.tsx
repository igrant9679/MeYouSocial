import { Suspense } from "react";
import Link from "next/link";
import { Bell, LogOut, Layers, User } from "lucide-react";
import { unreadCount } from "@/lib/notify";
import { BrandLogo } from "@/components/BrandLogo";
import { LiveTicker } from "@/components/LiveTicker";
import { tickerEvents } from "@/lib/dashboard-data";
import { signOut } from "@/auth";
import { getActiveChannel } from "@/lib/channel";
import { isPlatformOperator } from "@/lib/acl";
import { setActiveChannelAction } from "@/app/actions/channel";
import { LeftRailNav, type LeftRailItem } from "@/components/LeftRailNav";
import { MobileNav } from "@/components/MobileNav";
import { ChannelSwitcher } from "@/components/ChannelSwitcher";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { setActiveWorkspaceAction } from "@/app/actions/workspace-switch";
import { storage } from "@/lib/storage";
import { db } from "@/lib/db";
import { Elsie } from "@/components/Elsie";
import { FlashBanner } from "@/components/FlashBanner";
import { getGuideState } from "@/app/actions/guide";
import { relevantSteps, outstandingSetup, availableTracks, type SetupState } from "@/lib/guide/steps";

// Each nav item carries its own brand color so the rail reads as a vibrant chip strip
// (mirrors the CreateUp_Mockups.html per-module accent palette).
const NAV: (LeftRailItem & { adminOnly?: boolean })[] = [
  { href: "/dashboard",   label: "Home",        icon: "Home",          color: "#E5482F", soft: "#FDE7E1" },
  { href: "/channels",    label: "Channels",    icon: "Layers",        color: "#7C3AED", soft: "#EEE7FC" },
  { href: "/intel",       label: "Intel",       icon: "Telescope",     color: "#2563EB", soft: "#E5EDFD" },
  { href: "/ideas",       label: "Ideas",       icon: "Sparkles",      color: "#D97706", soft: "#FBEED5" },
  { href: "/scripts",     label: "Scripts",     icon: "PenLine",       color: "#15924B", soft: "#E0F2E8" },
  { href: "/blog",        label: "Blog",        icon: "FileText",      color: "#E11D48", soft: "#FBDFE6" },
  { href: "/reports",     label: "Reports",     icon: "FileBarChart",  color: "#4F46E5", soft: "#E7E6FB" },
  { href: "/insights",    label: "Insights",    icon: "LineChart",     color: "#15924B", soft: "#E0F2E8" },
  { href: "/videos",      label: "Videos",      icon: "Clapperboard",  color: "#7C3AED", soft: "#EEE7FC" },
  { href: "/social",      label: "Social",      icon: "Share2",        color: "#0A66C2", soft: "#E5EDFD" },
  { href: "/brand",       label: "Brand",       icon: "Palette",       color: "#DB2777", soft: "#FBE2EF" },
  { href: "/chat",        label: "Chat",        icon: "MessageCircle", color: "#6D28D9", soft: "#EDE7FB" },
  { href: "/thumbnails",  label: "Thumbnails",  icon: "ImageIcon",     color: "#DB2777", soft: "#FBE2EF" },
  { href: "/production",  label: "Production",  icon: "KanbanSquare",  color: "#0D9488", soft: "#D7F1ED" },
  { href: "/help",        label: "Help",        icon: "HelpCircle",    color: "#0891B2", soft: "#D8EFF5" },
  { href: "/admin",       label: "Admin",       icon: "Settings",      color: "#4F46E5", soft: "#E7E6FB", adminOnly: true },
];

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, membership, channels, active } = await getActiveChannel();
  const userLabel = user.name ?? user.email.split("@")[0];
  const navItems = NAV.filter((n) => !n.adminOnly || membership.role === "ADMIN");
  const workspaceChoices = user.memberships
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.workspaceId, name: m.workspace.name }));
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
  const brandName = isBranded ? workspace.name : "MeYouSocial";
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
  const [unread, ticker] = await Promise.all([
    unreadCount(workspace.id, user.id),
    tickerEvents(workspace.id, 12),
  ]);

  // Elsie, the guide. Her setup steps are filtered against what this workspace
  // has actually done, so she never walks anyone through work already finished.
  // All counts, deliberately — cheap enough to run on every page render.
  const guide = await getGuideState();
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
          href="/dashboard"
          className="flex items-center justify-center @6xl:justify-start gap-2.5 px-0 @6xl:px-2 py-1.5 mb-2 rounded-xl"
          title={isBranded ? `${workspace.name} on MeYouSocial · Home` : "MeYouSocial · Home"}
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
            {/* The product byline. Only when the workspace has its own branding
                — an unbranded install already says MeYouSocial above, and
                repeating it would just be noise. Hidden with the wordmark when
                the rail collapses to icons; there is no room for either. */}
            {isBranded && (
              <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] leading-tight mt-0.5">
                <BrandLogo size={11} /> MeYouSocial
              </span>
            )}
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
            <MobileNav items={navItems} userLabel={userLabel} signOutAction={signOutAction} logoUrl={logoUrl} brandName={brandName} coBranded={isBranded} />
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
          {active && (
            <form action={setActiveChannelAction}>
              <ChannelSelect channels={channels} activeId={active.id} />
            </form>
          )}
          {/* Priority order under shrinking effective width: ticker and email
              drop first, then the redundant buttons ("Manage channels" repeats
              the workspace-name link; "+ Channel" lives on /channels too). */}
          {/* !hidden: .btn is unlayered CSS (display:inline-flex) and beats the
              layered hidden utility — these two buttons were visible at EVERY
              width since the header shipped, part of the reported crowding. */}
          <Link href="/onboarding/channel/new" className="btn !hidden @4xl:!inline-flex items-center gap-1.5" title="Create a new YouTube channel">
            <Layers className="w-4 h-4" /> + Channel
          </Link>
          {/* @min-[88rem]: the 1024-1400 header is otherwise FULL — the ticker
              (which the user wants wide) only gets space these two give up;
              this link duplicates the workspace-name link anyway. */}
          <Link href="/channels" className="btn !hidden @min-[88rem]:!inline-flex" title="Manage all channels">Manage channels</Link>
          <LiveTicker initial={ticker} />
          <div className="flex-1" />
          <Elsie steps={elsieSteps} tracks={elsieTracks} enabled={guide.enabled} outstanding={elsieOutstanding} snoozed={guide.snoozed} />
          <Link
            href="/notifications"
            className="relative inline-flex items-center justify-center w-11 h-11 rounded-xl hover:bg-[var(--zebra)] transition-colors"
            title={unread ? `${unread} unread notifications` : "Notifications"}
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          >
            <Bell className="w-[21px] h-[21px]" strokeWidth={2.25} />
            {unread > 0 && (
              <span
                className="badge-pop absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-mono font-bold grid place-items-center"
                style={{ background: "var(--brand, #E5482F)", color: "#fff" }}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
          <span className="hidden @md:inline-block font-mono text-[12px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>{membership.role}</span>
          <span className="hidden @min-[88rem]:inline text-[13px] text-[var(--mute)] truncate max-w-[24ch]">{user.email}</span>
        </header>

        {/* Also a @container: page components size against the CONTENT area
            (shell minus rail), the width that actually constrains them. */}
        {/* Suspense: FlashBanner reads useSearchParams, which Next requires be
            suspended so a page can still be prerendered around it. */}
        <main className="flex-1 overflow-auto bg-[var(--panel)] p-6 @container">
          <Suspense fallback={null}><FlashBanner /></Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

function ChannelSelect({ channels, activeId }: { channels: { id: string; name: string; accentColor: string | null }[]; activeId: string }) {
  const active = channels.find((c) => c.id === activeId);
  return (
    <label className="flex items-center gap-2 font-mono text-[13px] font-semibold pl-1.5 pr-2 py-1 rounded-full border border-[var(--line-2)] hover:border-[var(--accent)] transition" title="Active channel — pick to switch">
      <span
        className="w-7 h-7 rounded-full text-white grid place-items-center text-[11px] font-bold"
        style={{ background: active?.accentColor ?? "var(--accent)" }}
        aria-hidden
      >
        {(active?.name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--mute)] hidden sm:inline">Active</span>
      <ChannelSwitcher channels={channels} activeId={activeId} />
    </label>
  );
}
