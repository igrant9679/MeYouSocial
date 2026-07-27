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

    // ALWAYS write a baseline first so the UI completes even if the LLM call
    // fails later. `source` says plainly that nothing has trained it yet — a
    // generic baseline rendered with no marker reads as a trained profile, and
    // baselineVoice() is entirely invented ("30s", "warm-curious", "Here's the
    // thing —"). Overwritten below the moment real material is found.
    let voiceData: Record<string, unknown> = {
      ...baselineVoice(channel.nicheDescription ?? ""),
      source: { trained: false, reason: "No channel material read yet." },
    };
    const writeVoice = async () => {
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
    };
    await writeVoice();
    await ctx.progress(0.3);

    if (channel.linkedYoutubeId) {
      const videos = await youtubeFor(channel.workspaceId).listVideos(channel.linkedYoutubeId, 25);

      // ⚠ TRAINS ON TITLES + DESCRIPTIONS, NOT TRANSCRIPTS — deliberate, and it
      // is what makes this job work at all. `getTranscript` returns null on the
      // real provider (caption download needs OAuth with youtube.force-ssl, not
      // an API key), and the old gate additionally required 3 videos of 180s+.
      // A Shorts-heavy channel therefore hit BOTH walls: the LLM branch never
      // ran and the stored profile stayed a generic placeholder that looked
      // trained. Titles and descriptions are the creator's own writing, come
      // back on every listVideos call, and a 30-second video's title is no less
      // authored than a 20-minute one's — so no duration filter.
      const corpus = videos
        .map((v) => [v.title, (v.description ?? "").slice(0, 600)].filter(Boolean).join("\n").trim())
        .filter((t) => t.length > 0);

      // Kept opportunistically: the mock provider does return transcripts, and
      // a future OAuth scope would too. Absent, the profile is titles-only and
      // says so rather than pretending otherwise.
      const transcripts = (
        await Promise.all(videos.slice(0, 5).map((v) => youtubeFor(channel.workspaceId).getTranscript(v.id)))
      ).filter(Boolean) as string[];

      ctx.log(`voice: ${corpus.length}/${videos.length} videos with text, ${transcripts.length} transcripts`);
      await ctx.progress(0.5);

      if (corpus.length < 3) {
        voiceData = {
          ...voiceData,
          source: { trained: false, reason: `Only ${corpus.length} video(s) with readable text on the linked channel — need at least 3.` },
        };
        await writeVoice();
      } else {
        const basis = transcripts.length ? "transcripts plus video titles and descriptions" : "video titles and descriptions";
        try {
          const completion = await llm.complete({
            // ⚠ NOT a hard-coded model. These three jobs used to pin
            // "claude-sonnet" while every other generation path resolves
            // `channel.defaultModel` first — so pointing a channel at Gemini
            // silently did nothing here, the call went to an Anthropic key that
            // was out of credit, and the router's fallback-to-mock turned a
            // "re-train from real data" into invented text with no error.
            model: channel.defaultModel ?? llm.defaultModel,
            // The system prompt names the evidence and forbids inventing past
            // it. Titles and descriptions show diction, hooks and framing; they
            // show NOTHING about cadence, energy or pacing, and a model asked
            // for a "voice profile" will happily supply all three anyway.
            system:
              "You build a structured voice profile for a video creator from their own written material." +
              " Ground every claim in the supplied text. Where the material cannot evidence something —" +
              " spoken cadence, energy or pacing cannot be inferred from titles and descriptions —" +
              " say \"not evidenced by the available material\" rather than guessing.",
            messages: [
              {
                role: "user",
                content:
                  `Niche: ${channel.nicheDescription}\n` +
                  `Presentation style: ${channel.presentationStyle}\n` +
                  `Material below is: ${basis}.\n\n` +
                  (transcripts.length ? `Transcripts:\n${transcripts.join("\n\n---\n\n").slice(0, 6000)}\n\n` : "") +
                  `Video titles and descriptions (${corpus.length} videos):\n${corpus.join("\n\n---\n\n").slice(0, 8000)}\n\n` +
                  `Return a profile covering archetype, delivery, rhetoric, diction and extras.`,
              },
            ],
            workspaceId: channel.workspaceId,
          });
          voiceData = {
            ...voiceData,
            summary: completion.content,
            source: { trained: true, basis, videos: corpus.length, transcripts: transcripts.length, model: channel.defaultModel ?? llm.defaultModel },
          };
          await writeVoice();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ctx.log(`voice: LLM enrichment failed, keeping baseline. ${message}`);
          voiceData = { ...voiceData, source: { trained: false, reason: `The model call failed: ${message.slice(0, 200)}` } };
          await writeVoice();
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
        // See the note in onboarding.voice — resolve the channel's model, never
        // pin one, or a workspace on Gemini silently falls back to mock.
        model: channel.defaultModel ?? llm.defaultModel,
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
            strategy: "Placeholder — generic hook, not derived from this channel or its competitors.",
            // ⚠ NO INVENTED SCORE. This used to write `2 + Math.random() * 4`,
            // so a placeholder landed in the list wearing a "4.7x outlier"
            // badge indistinguishable from one computed off real competitor
            // views. null renders as "—x", which is the truth: nothing measured
            // this.
            outlierScore: null,
            suggestedLength: "8–12 min",
            topic: channel.nicheDescription?.slice(0, 80) ?? null,
          },
        });
      }
    }
    await ctx.progress(0.7);

    try {
      const completion = await llm.complete({
        // See the note in onboarding.voice — resolve the channel's model, never
        // pin one, or a workspace on Gemini silently falls back to mock.
        model: channel.defaultModel ?? llm.defaultModel,
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
            // The score is the SEED's real outlier ratio (competitor views over
            // that competitor's average), carried onto the idea it inspired.
            // When the model returns more ideas than there were seeds, the
            // extras have no measurement behind them — `?? 2 + Math.random()*4`
            // used to invent one, which put a fabricated multiplier in the same
            // column as a computed one. null renders as "—x".
            outlierScore: seed[i]?.outlier ?? null,
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
