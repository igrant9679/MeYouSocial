import { jobs } from "@/lib/jobs";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { llm } from "@/lib/llm";
import { writeJson } from "@/lib/db/json";

// Onboarding background jobs.
//   • voice    — trains a VoiceProfile from the channel's top videos.
//   • audience — generates an AudienceAvatar.
//   • ideas    — produces 10 starter ideas based on outlier competitor videos.
//
// In mock mode these all run in-process within ~2-3 seconds and use the mock LLM/YouTube
// providers, which behave like the real thing from the app's POV. With real providers wired
// up later, the same handlers will run for ~minutes (per spec target).

type Payload = { channelId: string };

let registered = false;

export function registerOnboardingJobs() {
  if (registered) return;
  registered = true;

  jobs.register<Payload>("onboarding.voice", async ({ channelId }, ctx) => {
    await ctx.progress(0.1);
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) return;

    // ALWAYS write a baseline first so the UI completes even if the LLM call fails later.
    let voiceData: Record<string, unknown> = baselineVoice(channel.nicheDescription ?? "");
    await db.voiceProfile.upsert({
      where: { id: `voice-${channelId}-default` },
      update: { data: writeJson(voiceData), isDefault: true },
      create: {
        id: `voice-${channelId}-default`,
        channelId,
        label: "Default voice",
        isDefault: true,
        data: writeJson(voiceData),
      },
    });
    await ctx.progress(0.3);

    if (channel.linkedYoutubeId) {
      const videos = await youtubeFor(channel.workspaceId).listVideos(channel.linkedYoutubeId, 10);
      const usable = videos.filter((v) => v.durationSeconds >= 180);
      ctx.log(`voice: ${usable.length}/${videos.length} videos usable`);
      await ctx.progress(0.4);

      if (usable.length >= 3) {
        // Pull transcripts to inform the voice model.
        const transcripts = (await Promise.all(usable.slice(0, 5).map((v) => youtubeFor(channel.workspaceId).getTranscript(v.id))))
          .filter(Boolean) as string[];
        await ctx.progress(0.7);

        try {
          const completion = await llm.complete({
            model: "claude-sonnet",
            system: "You produce a structured voice profile from creator transcripts.",
            messages: [
              { role: "user", content: `Niche: ${channel.nicheDescription}\n\nStyle: ${channel.presentationStyle}\n\nTranscripts:\n${transcripts.join("\n\n---\n\n").slice(0, 8000)}\n\nReturn a JSON-ish profile of archetype, delivery, rhetoric, diction, and extras.` },
            ],
            workspaceId: channel.workspaceId,
          });
          voiceData = { ...voiceData, summary: completion.content };
          // Upgrade the baseline with the LLM-enriched profile.
          await db.voiceProfile.update({
            where: { id: `voice-${channelId}-default` },
            data: { data: writeJson(voiceData) },
          });
        } catch (e) {
          ctx.log(`voice: LLM enrichment failed, keeping baseline. ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    await ctx.progress(1);
  });

  jobs.register<Payload>("onboarding.audience", async ({ channelId }, ctx) => {
    await ctx.progress(0.1);
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) return;

    // ALWAYS create a baseline first so the UI doesn't hang if the LLM call fails.
    const baseline = {
      demographics:    writeJson({ summary: `Adults interested in ${channel.nicheDescription ?? "this niche"}.` }),
      psychographics:  writeJson({ summary: "Curious, growth-oriented, time-poor." }),
      onlineBehavior:  writeJson({ summary: "YouTube + niche communities; deep-dives." }),
      offlineBehavior: writeJson({ summary: "Commute / WFH / weekend project context." }),
      keyQuestions:    writeJson([
        "What's the most efficient way to do this?",
        "Whose advice should I actually trust?",
        "Where do experts disagree, and why?",
        "What do beginners get wrong about this?",
        "How will this look in 3 years?",
      ]),
    };
    await db.audienceAvatar.upsert({
      where: { channelId },
      update: baseline,
      create: { channelId, ...baseline },
    });
    await ctx.progress(0.4);

    try {
      const source = channel.linkedYoutubeId
        ? `Top videos: ${(await youtubeFor(channel.workspaceId).listVideos(channel.linkedYoutubeId, 5)).map((v) => v.title).join("; ")}`
        : `Description: ${channel.nicheDescription}`;
      const completion = await llm.complete({
        model: "claude-sonnet",
        system: "You generate audience avatars with demographics, psychographics, online behavior, offline behavior, and key questions.",
        messages: [{ role: "user", content: `Niche: ${channel.nicheDescription}\n${source}\n\nDifferentiation: ${channel.differentiation}\n\nProduce a JSON object with fields: demographics, psychographics, onlineBehavior, offlineBehavior, keyQuestions (array of 5 strings).` }],
        workspaceId: channel.workspaceId,
      });
      // Upgrade demographics text with the LLM-enriched version
      await db.audienceAvatar.update({
        where: { channelId },
        data: { demographics: writeJson({ summary: completion.content.slice(0, 600) }) },
      });
    } catch (e) {
      ctx.log(`audience: LLM enrichment failed, keeping baseline. ${e instanceof Error ? e.message : e}`);
    }
    await ctx.progress(1);
  });

  jobs.register<Payload>("onboarding.ideas", async ({ channelId }, ctx) => {
    await ctx.progress(0.1);
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      include: { competitors: true, channelStats: { orderBy: { capturedAt: "desc" }, take: 20 } },
    });
    if (!channel) return;

    // surface own-channel perf trends into idea generation.
    let perfHint = "";
    if (channel.channelStats.length > 0) {
      const top = channel.channelStats.slice(0, 5);
      const avgRet = top.reduce((a, s) => a + (s.retentionProxy ?? 0), 0) / top.length;
      perfHint = `\nOwn-channel performance hint: avg retention ${(avgRet * 100).toFixed(0)}% across the last ${top.length} tracked uploads. Bias new ideas toward formats that hold attention.`;
    }

    // Pull recent videos from each competitor and grab the strongest outlier.
    const candidates: { title: string; outlier: number; source: string }[] = [];
    for (const c of channel.competitors) {
      if (!c.youtubeId) continue;
      const videos = await youtubeFor(channel.workspaceId).listVideos(c.youtubeId, 8);
      const avgViews = videos.reduce((a, v) => a + v.views, 0) / Math.max(1, videos.length);
      for (const v of videos) {
        candidates.push({
          title: v.title,
          outlier: v.views / Math.max(1, avgViews),
          source: c.youtubeHandle ?? c.youtubeId ?? "",
        });
      }
    }
    candidates.sort((a, b) => b.outlier - a.outlier);
    await ctx.progress(0.6);

    const seed = candidates.slice(0, 10);

    // ALWAYS seed at least 5 baseline ideas so the UI completes if the LLM call fails.
    const baselineIdeas = [
      "Why everything you know about this is wrong",
      "The 80/20 nobody talks about",
      "I tried this for 30 days — here's what happened",
      "Stop doing this. Do this instead.",
      "What experts get wrong about this",
    ];
    const existingIdeaCount = await db.idea.count({ where: { channelId } });
    if (existingIdeaCount === 0) {
      for (const title of baselineIdeas) {
        await db.idea.create({
          data: {
            channelId,
            title,
            strategy: "Counter-intuitive hook with research-backed payoff.",
            outlierScore: 2 + Math.random() * 4,
            suggestedLength: "8–12 min",
            topic: channel.nicheDescription?.slice(0, 80) ?? null,
          },
        });
      }
    }
    await ctx.progress(0.7);

    try {
      const completion = await llm.complete({
        model: "claude-sonnet",
        system: "You convert outlier video titles into 10 fresh idea titles for a creator in a related niche, preserving each one's hook structure.",
        messages: [
          { role: "user", content: `Creator niche: ${channel.nicheDescription}\nDifferentiation: ${channel.differentiation}${perfHint}\nOutlier seeds:\n${seed.map((s, i) => `${i + 1}. (${s.outlier.toFixed(1)}x) ${s.title}`).join("\n")}\n\nReturn one idea per line: "title — strategy".` },
        ],
        workspaceId: channel.workspaceId,
      });

      const lines = completion.content
        .split("\n")
        .map((l) => l.replace(/^[*\-\d.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 10);

      for (let i = 0; i < lines.length; i++) {
        const [title, strategy] = lines[i].split("—").map((s) => s.trim());
        if (!title) continue;
        await db.idea.create({
          data: {
            channelId,
            title,
            strategy: strategy ?? "Counter-intuitive hook with research-backed payoff.",
            outlierScore: seed[i]?.outlier ?? 2 + Math.random() * 4,
            suggestedLength: "8–12 min",
            topic: channel.nicheDescription?.slice(0, 80) ?? null,
          },
        });
      }
    } catch (e) {
      ctx.log(`ideas: LLM enrichment failed, keeping baseline. ${e instanceof Error ? e.message : e}`);
    }
    await ctx.progress(1);
  });
}

function baselineVoice(niche: string): Record<string, unknown> {
  return {
    archetype: { ageVibe: "30s", profession: "subject-matter expert", temperament: "warm-curious", authority: "peer-expert" },
    delivery: { cadence: "measured", energy: "warm-medium", pacing: "varied" },
    rhetoric: { hooks: ["counter-intuitive", "story-led"], transitions: ["bridge", "callback"], cta: "soft" },
    diction: { vocabulary: "everyday-precise", sentenceShape: "mixed", avoid: ["literally", "very", "just"] },
    extras: { phraseKit: ["Here's the thing —", "Most people miss this:"], niche },
  };
}
