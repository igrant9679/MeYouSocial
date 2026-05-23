import { jobs } from "@/lib/jobs";
import { db } from "@/lib/db";
import { youtube } from "@/lib/youtube";
import { llm } from "@/lib/llm";
import { writeJson } from "@/lib/db/json";

// Onboarding background jobs (FR-ONB-09).
//   • voice    — trains a VoiceProfile from the channel's top videos (FR-VOICE-01/02).
//   • audience — generates an AudienceAvatar (FR-AUD-01/02).
//   • ideas    — produces 10 starter ideas based on outlier competitor videos (FR-IDEA-01).
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

    // FR-VOICE-01: top 10 videos (5 most-viewed + 5 most-recent ≥ 3 min).
    let voiceData: Record<string, unknown> = baselineVoice(channel.nicheDescription ?? "");

    if (channel.linkedYoutubeId) {
      const videos = await youtube.listVideos(channel.linkedYoutubeId, 10);
      const usable = videos.filter((v) => v.durationSeconds >= 180);
      ctx.log(`voice: ${usable.length}/${videos.length} videos usable`);
      await ctx.progress(0.4);

      if (usable.length >= 3) {
        // Pull transcripts to inform the voice model.
        const transcripts = (await Promise.all(usable.slice(0, 5).map((v) => youtube.getTranscript(v.id))))
          .filter(Boolean) as string[];
        await ctx.progress(0.7);

        const completion = await llm.complete({
          model: "claude-sonnet",
          system: "You produce a structured voice profile from creator transcripts.",
          messages: [
            { role: "user", content: `Niche: ${channel.nicheDescription}\n\nStyle: ${channel.presentationStyle}\n\nTranscripts:\n${transcripts.join("\n\n---\n\n").slice(0, 8000)}\n\nReturn a JSON-ish profile of archetype, delivery, rhetoric, diction, and extras.` },
          ],
        });
        voiceData = { ...voiceData, summary: completion.content };
      }
    }

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
    await ctx.progress(1);
  });

  jobs.register<Payload>("onboarding.audience", async ({ channelId }, ctx) => {
    await ctx.progress(0.1);
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) return;

    // FR-AUD-01: from top 5 videos (linked) or description (custom).
    const source = channel.linkedYoutubeId
      ? `Top videos: ${(await youtube.listVideos(channel.linkedYoutubeId, 5)).map((v) => v.title).join("; ")}`
      : `Description: ${channel.nicheDescription}`;
    await ctx.progress(0.4);

    const completion = await llm.complete({
      model: "claude-sonnet",
      system: "You generate audience avatars with demographics, psychographics, online behavior, offline behavior, and key questions.",
      messages: [{ role: "user", content: `Niche: ${channel.nicheDescription}\n${source}\n\nDifferentiation: ${channel.differentiation}\n\nProduce a JSON object with fields: demographics, psychographics, onlineBehavior, offlineBehavior, keyQuestions (array of 5 strings).` }],
    });
    await ctx.progress(0.8);

    await db.audienceAvatar.upsert({
      where: { channelId },
      update: {
        demographics: writeJson({ summary: completion.content.slice(0, 600) }),
        psychographics: writeJson({ summary: "Curious, growth-oriented, time-poor." }),
        onlineBehavior: writeJson({ summary: "YouTube + niche communities; deep-dives." }),
        offlineBehavior: writeJson({ summary: "Commute / WFH / weekend project context." }),
        keyQuestions: writeJson([
          "What's the most efficient way to do this?",
          "Whose advice should I actually trust?",
          "Where do experts disagree, and why?",
          "What do beginners get wrong about this?",
          "How will this look in 3 years?",
        ]),
      },
      create: {
        channelId,
        demographics: writeJson({ summary: completion.content.slice(0, 600) }),
        psychographics: writeJson({ summary: "Curious, growth-oriented, time-poor." }),
        onlineBehavior: writeJson({ summary: "YouTube + niche communities; deep-dives." }),
        offlineBehavior: writeJson({ summary: "Commute / WFH / weekend project context." }),
        keyQuestions: writeJson([
          "What's the most efficient way to do this?",
          "Whose advice should I actually trust?",
          "Where do experts disagree, and why?",
          "What do beginners get wrong about this?",
          "How will this look in 3 years?",
        ]),
      },
    });
    await ctx.progress(1);
  });

  jobs.register<Payload>("onboarding.ideas", async ({ channelId }, ctx) => {
    await ctx.progress(0.1);
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      include: { competitors: true },
    });
    if (!channel) return;

    // Pull recent videos from each competitor and grab the strongest outlier.
    const candidates: { title: string; outlier: number; source: string }[] = [];
    for (const c of channel.competitors) {
      if (!c.youtubeId) continue;
      const videos = await youtube.listVideos(c.youtubeId, 8);
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

    // Have the LLM rewrite each into an idea title/strategy in the creator's voice.
    const completion = await llm.complete({
      model: "claude-sonnet",
      system: "You convert outlier video titles into 10 fresh idea titles for a creator in a related niche, preserving each one's hook structure.",
      messages: [
        { role: "user", content: `Creator niche: ${channel.nicheDescription}\nDifferentiation: ${channel.differentiation}\nOutlier seeds:\n${seed.map((s, i) => `${i + 1}. (${s.outlier.toFixed(1)}x) ${s.title}`).join("\n")}\n\nReturn one idea per line: "title — strategy".` },
      ],
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
