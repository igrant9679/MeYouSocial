import { NextRequest } from "next/server";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { readJson, writeJson } from "@/lib/db/json";
import { countWords, durationSeconds, MAX_WORDS } from "@/lib/canvas/duration";
import { systemForOutline, systemForScript } from "@/lib/canvas/prompts";

// streaming script (or outline) generation via Server-Sent Events.
// GET /api/scripts/[id]/generate?stage=outline|script

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: {
      channel: { include: { voiceProfiles: { where: { isDefault: true } }, audience: true } },
      template: true,
    },
  });
  if (!script) return new Response("not found", { status: 404 });

  const stage = req.nextUrl.searchParams.get("stage") === "outline" ? "outline" : "script";
  const voice = script.channel.voiceProfiles[0]?.data ?? "";
  const audienceKQ = readJson<string[]>(script.channel.audience?.keyQuestions ?? null, []);
  const templateName = script.template?.name ?? "Flexible";
  const outline = readJson<{ markdown?: string; questions?: Record<string, string> }>(script.outline ?? null, {});

  const system = stage === "outline"
    ? systemForOutline({
        channelName: script.channel.name,
        niche: script.channel.nicheDescription ?? "",
        differentiation: script.channel.differentiation ?? "",
        audienceKQ,
        voice,
        template: templateName,
      })
    : systemForScript({
        channelName: script.channel.name,
        niche: script.channel.nicheDescription ?? "",
        voice,
        template: templateName,
        lengthGuide: "8-12 minutes (~1500-2400 words)",
      });

  const userContent = stage === "outline"
    ? [
        `Title: ${script.title}`,
        outline.questions?.takeaway ? `Main takeaway: ${outline.questions.takeaway}` : "",
        outline.questions?.concerns ? `Audience concerns: ${outline.questions.concerns}` : "",
        outline.questions?.points ? `Points to cover: ${outline.questions.points}` : "",
        outline.questions?.action ? `Desired viewer action: ${outline.questions.action}` : "",
      ].filter(Boolean).join("\n")
    : `Outline:\n\n${outline.markdown ?? "(no outline)"}\n\nExpand into a full spoken-style script.`;

  // Build the SSE stream.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      try {
        for await (const chunk of llm.stream({
          model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
          system,
          messages: [{ role: "user", content: userContent }],
          workspaceId: workspace.id,
        })) {
          buffer += chunk;
          // Each SSE frame is `data: <json>\n\n`. We send the cumulative content
          // so reconnecting clients can pick up where they left off.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`));
        }

        // Persist the final result to the script.
        if (stage === "outline") {
          await db.scriptVersion.create({
            data: { scriptId: script.id, label: "outline (streamed)", outline: buffer },
          });
          await db.script.update({
            where: { id: script.id },
            data: {
              outline: writeJson({ ...outline, markdown: buffer }),
              status: "planning",
            },
          });
        } else {
          const words = countWords(buffer);
          await db.scriptVersion.create({
            data: { scriptId: script.id, label: "script (streamed)", body: buffer, wordCount: words },
          });
          await db.script.update({
            where: { id: script.id },
            data: {
              body: buffer,
              wordCount: Math.min(words, MAX_WORDS),
              durationSeconds: durationSeconds(words),
              status: "draft",
            },
          });
        }

        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`));
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
