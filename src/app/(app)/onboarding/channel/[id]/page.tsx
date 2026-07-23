import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { redirect } from "next/navigation";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { StepHeader } from "@/components/onboarding/StepHeader";
import { readJson } from "@/lib/db/json";
import {
  lookupYoutubeAction,
  customChannelAction,
  saveCompetitorsAction,
  differentiationAction,
  finishOnboardingAction,
} from "@/app/actions/onboarding";

type SP = Promise<{ step?: string; path?: string; error?: string }>;

export default async function OnboardingChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const { id } = await params;
  const { step = "2", path = "youtube", error } = await searchParams;
  const { channel } = await requireChannel(id);

  const stepNum = Number(step);

  if (stepNum === 2 && path === "youtube") return <StepTwoYouTube channelId={channel.id} error={error} />;
  if (stepNum === 2 && path === "custom") return <StepTwoCustom channelId={channel.id} error={error} />;
  if (stepNum === 3) return <StepThreeCompetitors channel={channel} path={path} error={error} />;
  if (stepNum === 4) return <StepFourDifferentiation channelId={channel.id} error={error} />;
  if (stepNum === 5) return <StepFivePreview channelId={channel.id} />;
  redirect(`/onboarding/channel/${channel.id}?step=2`);
}

// ── Step 2 — YouTube path lookup ───────────────────────────────
function StepTwoYouTube({ channelId, error }: { channelId: string; error?: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={2} total={5} title="Link your YouTube channel" subtitle="Paste your channel URL or @handle — no YouTube login needed." />
      <form action={lookupYoutubeAction} className="card flex flex-col gap-4 mt-5">
        <input type="hidden" name="channelId" value={channelId} />
        {error === "notfound" && <p className="text-sm text-[var(--brand)]">No channel found for that handle.</p>}
        {error === "invalid" && <p className="text-sm text-[var(--brand)]">Please enter a handle or URL.</p>}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">YouTube @handle or URL</span>
          <input name="handle" required placeholder="@hubermanlab" className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>
        <p className="text-xs text-[var(--mute)]">Mock mode returns a plausible channel for any handle so you can demo the full flow.</p>
        <div className="flex justify-between items-center mt-2">
          <Link href={`/onboarding/channel/${channelId}?step=2&path=custom`} className="text-xs text-[var(--mute)] underline">Use custom path instead →</Link>
          <SubmitButton className="btn primary">Look up & continue →</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ── Step 2 — Custom path ───────────────────────────────────────
function StepTwoCustom({ channelId, error }: { channelId: string; error?: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={2} total={5} title="Describe your new channel" subtitle="No videos yet? Give us a name and detailed niche description." />
      <form action={customChannelAction} className="card flex flex-col gap-4 mt-5">
        <input type="hidden" name="channelId" value={channelId} />
        {error && <p className="text-sm text-[var(--brand)]">Name (2+ chars) and description (20+ chars) are required.</p>}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Channel name</span>
          <input name="name" required maxLength={120} className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Detailed niche & audience description</span>
          <textarea name="description" required minLength={20} rows={4} className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>
        <div className="flex justify-between items-center mt-2">
          <Link href={`/onboarding/channel/${channelId}?step=2&path=youtube`} className="text-xs text-[var(--mute)] underline">Link a YouTube channel instead →</Link>
          <SubmitButton className="btn primary">Continue →</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ── Step 3 — Competitors ──────────────────────────
async function StepThreeCompetitors({ channel, path, error }: { channel: { id: string; workspaceId: string; nicheDescription: string | null }; path: string; error?: string }) {
  // AI-suggest a couple of competitor handles in the same niche (mock-friendly).
  const suggestions = await youtubeFor(channel.workspaceId).searchChannels(channel.nicheDescription?.split(/\s+/)[0] ?? "creator", 4);
  const existing = await db.competitor.findMany({ where: { channelId: channel.id } });

  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={3} total={5} title="Pick competitors & inspirations" subtitle="3–5 channels in your niche. Optional — you can skip and add later." />
      <form action={saveCompetitorsAction} className="card flex flex-col gap-4 mt-5">
        <input type="hidden" name="channelId" value={channel.id} />
        <input type="hidden" name="path" value={path} />
        {error && <p className="text-sm text-[var(--brand)]">Failed to save.</p>}
        <div>
          <p className="text-xs font-mono uppercase text-[var(--mute)] mb-2">Suggested in your niche</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <span key={s.id} className="tag" title={`${s.subscribers.toLocaleString()} subs`}>{s.handle}</span>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Your competitor handles (comma or newline separated)</span>
          <textarea name="handles" rows={3} placeholder={suggestions.map((s) => s.handle).join(", ")} defaultValue={existing.map((c) => c.youtubeHandle).filter(Boolean).join(", ")} className="border border-[var(--line-2)] rounded-lg p-3 text-sm font-mono" />
        </label>
        <div className="flex justify-between items-center mt-2">
          <button type="submit" name="skip" value="1" className="text-xs text-[var(--mute)] underline">Skip for now</button>
          <SubmitButton className="btn primary">Save & continue →</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ── Step 4 — Differentiation ───────────────────────────────────
function StepFourDifferentiation({ channelId, error }: { channelId: string; error?: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={4} total={5} title="What makes you different?" subtitle="A short differentiation statement (≥ 20 chars) shapes everything we generate next." />
      <form action={differentiationAction} className="card flex flex-col gap-4 mt-5">
        <input type="hidden" name="channelId" value={channelId} />
        {error && <p className="text-sm text-[var(--brand)]">Must be at least 20 characters.</p>}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Differentiation</span>
          <textarea name="differentiation" required minLength={20} rows={3} placeholder="e.g. I cite the actual papers and show the math instead of vague advice." className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>
        <div className="flex justify-end">
          <SubmitButton className="btn primary">Start generating →</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ── Step 5 — Preview + background generation status (/10) ──────
async function StepFivePreview({ channelId }: { channelId: string }) {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { audience: true, voiceProfiles: { where: { isDefault: true } }, ideas: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!channel) redirect("/onboarding/channel/new");

  const voiceData = readJson<Record<string, unknown>>(channel.voiceProfiles[0]?.data ?? null, {});
  const keyQuestions = readJson<string[]>(channel.audience?.keyQuestions ?? null, []);

  const ready = {
    voice: channel.voiceProfiles.length > 0,
    audience: !!channel.audience,
    ideas: channel.ideas.length > 0,
  };

  return (
    <div className="max-w-3xl mx-auto">
      <StepHeader step={5} total={5} title="Preview — and start scripting" subtitle="You can leave this page; generation continues in the background." />

      <div className="grid grid-cols-3 gap-3 mt-5">
        <StatusCard label="Voice profile" ready={ready.voice} />
        <StatusCard label="Audience avatar" ready={ready.audience} />
        <StatusCard label="Starter ideas" ready={ready.ideas} />
      </div>

      <section className="card mt-5">
        <h2 className="font-mono text-[15px] mb-3">Audience snapshot</h2>
        {ready.audience ? (
          <ul className="text-sm space-y-1">
            {keyQuestions.slice(0, 5).map((q, i) => (
              <li key={i} className="flex gap-2"><span className="text-[var(--mute)]">·</span>{q}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--mute)]">Generating…</p>
        )}
      </section>

      <section className="card mt-3">
        <h2 className="font-mono text-[15px] mb-3">Starter ideas</h2>
        {channel.ideas.length === 0 && <p className="text-sm text-[var(--mute)]">Generating…</p>}
        <ul className="m-0 p-0">
          {channel.ideas.map((i) => (
            <li key={i.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm flex items-center gap-3">
              <span className="tag">{i.outlierScore?.toFixed(1) ?? "—"}x</span>
              <span className="flex-1 truncate">{i.title}</span>
            </li>
          ))}
        </ul>
      </section>

      {Object.values(voiceData).length > 0 && (
        <section className="card mt-3">
          <h2 className="font-mono text-[15px] mb-2">Voice profile (preview)</h2>
          <p className="text-xs text-[var(--mute)]">Refine in Channel → Voice. <Link className="text-[var(--accent)] font-semibold" href={`/channels/${channelId}/voice`}>Open voice editor →</Link></p>
        </section>
      )}

      <div className="flex flex-wrap justify-between items-center mt-5 gap-2">
        <Link href={`/channels/${channelId}`} className="btn sm" title="Skip background generation — you can edit voice/audience later from the channel page">Skip — open channel anyway →</Link>
        <form action={finishOnboardingAction} className="flex items-center gap-2">
          <input type="hidden" name="channelId" value={channelId} />
          <SubmitButton className="btn primary">Open channel →</SubmitButton>
        </form>
      </div>

      <p className="text-xs text-[var(--mute)] mt-3 text-center">
        Page auto-refreshes every few seconds (stops after 90 seconds).{" "}
        <Link href={`/onboarding/channel/${channelId}?step=5`} className="underline">Refresh now</Link>.
      </p>

      <RefreshScript ready={Object.values(ready).every(Boolean)} />
    </div>
  );
}

function StatusCard({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="card flex items-center gap-3">
      <span className={"w-2.5 h-2.5 rounded-full " + (ready ? "bg-[var(--green)]" : "bg-[var(--amber)] animate-pulse")} />
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--mute)] font-mono">{ready ? "ready" : "generating…"}</div>
      </div>
    </div>
  );
}

function RefreshScript({ ready }: { ready: boolean }) {
  if (ready) return null;
  // Auto-refresh the page while jobs are running, but cap at 90 seconds
  // so a stuck job can never trap the user in a refresh loop.
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function(){
            try {
              const KEY = 'meyousocial_onboard_refresh_start';
              let start = sessionStorage.getItem(KEY);
              if (!start) { start = String(Date.now()); sessionStorage.setItem(KEY, start); }
              if (Date.now() - Number(start) < 90000) {
                setTimeout(() => location.reload(), 3000);
              } else {
                sessionStorage.removeItem(KEY);
              }
            } catch { setTimeout(() => location.reload(), 3000); }
          })();
        `,
      }}
    />
  );
}
