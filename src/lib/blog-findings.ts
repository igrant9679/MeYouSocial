import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import { getSearchProvider } from "@/lib/search";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { sanitizeRichHtml, unwrapBlockParagraphs } from "@/lib/richtext";
import { INTAKE_IDS, parseAnswers, selectSmeProfile } from "@/lib/sme";

/**
 * Optimize → "Address these" (One-Loop redesign, step 1).
 *
 * The E-E-A-T review, content-gap and entity-coverage analyses used to end in
 * a paragraph of advice. They now produce FINDINGS — cards with a kind that
 * decides what the app can honestly do about them:
 *
 *   mechanical  the article already holds what is needed and the fix is
 *               editorial → a proposed HTML addition, shown as a diff, applied
 *               only when someone (or auto-review) presses Apply.
 *   knowledge   only the author can supply it — first-hand experience,
 *               credentials, a real example → two or three questions. The
 *               answers are woven into the article as a proposal AND saved to
 *               the workspace's Experts profile, so they are asked once.
 *   strategic   a separate topic, not an edit → "add to ideas".
 *
 * ⚠ The rules that keep this honest, in order of how often they bite:
 *   · nothing is written to the article until a verb is pressed (Assist's
 *     propose-then-accept rule, one level up);
 *   · the LLM never verifies or invents — proposals may not carry numbers,
 *     studies or names the article did not already contain, and a knowledge
 *     card's passage is built from the author's answers and nothing else;
 *   · a mock reply produces no finding and no proposal (the router's silent
 *     fallback has stored fluent nonsense before — see blog-autopilot.ts);
 *   · a dismissed finding is never re-raised: the (post, fingerprint) unique
 *     index makes regeneration skip it.
 */

export type FindingKind = "mechanical" | "knowledge" | "strategic";
export type FindingSource = "eeat" | "content_gap" | "entity_coverage";
export const FINDING_SOURCES: FindingSource[] = ["eeat", "content_gap", "entity_coverage"];

export type FindingQuestion = { q: string; intakeId: string };

type DraftFinding = {
  kind: FindingKind;
  title: string;
  detail: string;
  proposal: string | null;
  anchor: string | null;
  questions: FindingQuestion[];
};

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const fingerprintOf = (source: string, title: string) =>
  `${source}:${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;

/** Proposals are HTML that will be inserted verbatim — same allowlist the editor enforces. */
function cleanProposal(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const html = sanitizeRichHtml(raw.trim().slice(0, 4000));
  return stripTags(html).length > 20 ? html : null;
}

const NO_INVENTION =
  "Never invent statistics, studies, client names, outcomes or quotations; a proposal may only state what the article already establishes or what is uncontroversial general knowledge.";

// ---- Generation ------------------------------------------------------------------

async function askForFindings(
  workspaceId: string,
  model: string,
  system: string,
  user: string,
): Promise<{ findings: DraftFinding[]; mock: boolean }> {
  const res = await llm.complete({
    model,
    system,
    messages: [{ role: "user", content: user }],
    // Reasoning models spend the budget thinking first (the documented
    // gemini trap) — give the JSON room and the call time.
    maxTokens: 4000,
    timeoutMs: 120_000,
    workspaceId,
  });
  if (res.provider === "mock") return { findings: [], mock: true };
  let parsed: { findings?: unknown[] } = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    parsed = m ? (JSON.parse(m[0]) as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  const out: DraftFinding[] = [];
  for (const raw of Array.isArray(parsed.findings) ? parsed.findings : []) {
    const f = raw as Record<string, unknown>;
    const title = typeof f.title === "string" ? f.title.trim().slice(0, 120) : "";
    if (!title) continue;
    const kind: FindingKind =
      f.kind === "knowledge" ? "knowledge" : f.kind === "strategic" ? "strategic" : "mechanical";
    const questions: FindingQuestion[] = Array.isArray(f.questions)
      ? (f.questions as unknown[])
          .map((q) => {
            const o = (q ?? {}) as Record<string, unknown>;
            const text = typeof o.q === "string" ? o.q.trim().slice(0, 300) : "";
            const intakeId = typeof o.intakeId === "string" && INTAKE_IDS.includes(o.intakeId) ? o.intakeId : "cases";
            return text ? { q: text, intakeId } : null;
          })
          .filter((q): q is FindingQuestion => q !== null)
          .slice(0, 3)
      : [];
    out.push({
      kind,
      title,
      detail: typeof f.detail === "string" ? f.detail.trim().slice(0, 400) : "",
      proposal: cleanProposal(f.proposal),
      anchor: typeof f.anchor === "string" ? f.anchor.trim().slice(0, 150) || null : null,
      questions,
    });
  }
  return { findings: out.slice(0, 4), mock: false };
}

const KNOWLEDGE_SIGNAL = /experience|first-hand|firsthand|credential|author|byline|cite|source|case stud|client|example from|testimon|your own/i;

/**
 * Run the three analyses and store what they find as cards. Idempotent per
 * (post, fingerprint): re-running adds new findings and never resurrects a
 * dismissed one. Returns how many were created and which sources ran.
 */
export async function generateFindingsCore(
  workspaceId: string,
  postId: string,
  opts?: { sources?: FindingSource[]; via?: string },
): Promise<{ created: number; ran: FindingSource[]; skipped: Array<{ source: FindingSource; why: string }> }> {
  const result = { created: 0, ran: [] as FindingSource[], skipped: [] as Array<{ source: FindingSource; why: string }> };
  if (await isGloballyPaused(workspaceId)) return result;
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId }, include: { citations: true } });
  if (!post?.body) return result;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const org = await db.orgProfile.findUnique({ where: { workspaceId } });
  const model = await resolveUsableModel(post.model ?? workspace?.defaultModel ?? llm.defaultModel, workspaceId);
  const text = stripTags(post.body).slice(0, 3500);
  const headings = [...post.body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  const sources = opts?.sources ?? FINDING_SOURCES;
  const drafts: Array<{ source: FindingSource; f: DraftFinding }> = [];

  if (sources.includes("eeat")) {
    const { findings, mock } = await askForFindings(
      workspaceId,
      model,
      "You review a blog article against E-E-A-T (experience, expertise, authoritativeness, trust) and return findings the publisher can ACT on. " +
        "Classify each finding by what it needs. " +
        'knowledge: only the author can supply it — first-hand experience, credentials, a real client example, a source they hold. Give 2–3 short, specific questions whose answers would resolve it; tag each with the intake area it belongs to, one of: practice, experience, credentials, misconceptions, opinions, cases, questions, always, never, explanations. ' +
        'mechanical: the article already contains what is needed and the fix is editorial — a clarifying paragraph from material already in the article, a summary, naming what the article already implies. Give the exact HTML to insert (one or two <p>, optionally an <h3>) and "anchor": the exact text of the existing h2 it belongs after ("" to append at the end). ' +
        NO_INVENTION +
        ' Respond ONLY with JSON: {"findings":[{"kind":"knowledge"|"mechanical","title":string,"detail":string,"questions":[{"q":string,"intakeId":string}],"proposal":string,"anchor":string}]} — at most 4, most valuable first; title is an imperative under 90 characters, detail says why it matters in one sentence.',
      [
        `Article: "${post.title}"`,
        org?.description ? `Publisher: ${org.description.slice(0, 300)}` : null,
        `Citations: ${post.citations.filter((c) => c.verified).length} verified, ${post.citations.filter((c) => !c.verified).length} unverified.`,
        headings.length ? `Existing h2 headings: ${headings.join(" | ")}` : null,
        `Content:\n${text}`,
      ].filter(Boolean).join("\n\n"),
    );
    if (mock) result.skipped.push({ source: "eeat", why: "AI provider unavailable" });
    else {
      result.ran.push("eeat");
      for (const f of findings) {
        // The model's judgement is advisory; anything that reads as needing
        // the author's own material is a knowledge card whatever it said.
        const needsAuthor = f.kind === "knowledge" || KNOWLEDGE_SIGNAL.test(`${f.title} ${f.detail}`);
        if (needsAuthor && f.questions.length === 0) continue; // unanswerable as posed
        drafts.push({ source: "eeat", f: { ...f, kind: needsAuthor ? "knowledge" : "mechanical", proposal: needsAuthor ? null : f.proposal } });
      }
    }
  }

  if (sources.includes("entity_coverage")) {
    const { findings, mock } = await askForFindings(
      workspaceId,
      model,
      "You check topical entity coverage for SEO: key concepts, tools, standards and named things an authoritative article on this topic mentions that this article does not (never statistics). " +
        'Group the missing entities into at most 3 mechanical findings. Each gives "proposal": one HTML <p> that works those entities into the article\'s argument using only uncontroversial general knowledge about them — no numbers, no claims about outcomes — and "anchor": the exact text of the existing h2 it belongs after ("" for the end). ' +
        NO_INVENTION +
        ' Respond ONLY with JSON: {"findings":[{"kind":"mechanical","title":string,"detail":string,"proposal":string,"anchor":string}]} — title names the entities (e.g. "Mention Search Console and impression data"), detail says why they belong.',
      [
        `Topic: ${post.focusKeyword ?? post.title}`,
        headings.length ? `Existing h2 headings: ${headings.join(" | ")}` : null,
        `Article:\n${text}`,
      ].filter(Boolean).join("\n\n"),
    );
    if (mock) result.skipped.push({ source: "entity_coverage", why: "AI provider unavailable" });
    else {
      result.ran.push("entity_coverage");
      for (const f of findings) if (f.proposal) drafts.push({ source: "entity_coverage", f: { ...f, kind: "mechanical", questions: [] } });
    }
  }

  if (sources.includes("content_gap")) {
    // ⚠ Real search data or nothing — a mock search result set would have the
    // model "comparing" the article against example.com.
    const { provider, real } = await getSearchProvider(workspaceId);
    if (!real) result.skipped.push({ source: "content_gap", why: "needs a search key" });
    else {
      const query = post.focusKeyword ?? post.title;
      const results = await provider.search(query, 6).catch(() => []);
      if (results.length === 0) result.skipped.push({ source: "content_gap", why: "search returned nothing" });
      else {
        const { findings, mock } = await askForFindings(
          workspaceId,
          model,
          "You compare an article against the top search results for its target query and return the subtopics competitors cover that the article does not. " +
            'For each decide: mechanical if it belongs INSIDE this article as a short section grounded in what the article already establishes — give "proposal" (an <h2> plus one or two <p>) and "anchor" (the exact text of the existing h2 it belongs after, "" for the end); strategic if it is a separate topic deserving its own article — no proposal. ' +
            NO_INVENTION +
            ' Respond ONLY with JSON: {"findings":[{"kind":"mechanical"|"strategic","title":string,"detail":string,"proposal":string,"anchor":string}]} — at most 4; detail names how many of the results cover it.',
          [
            `Query: ${query}`,
            headings.length ? `Existing h2 headings: ${headings.join(" | ")}` : null,
            `Article:\n${text.slice(0, 2500)}`,
            `Top results:\n${results.map((r) => `${r.title} — ${r.snippet ?? ""}`).join("\n")}`,
          ].filter(Boolean).join("\n\n"),
        );
        if (mock) result.skipped.push({ source: "content_gap", why: "AI provider unavailable" });
        else {
          result.ran.push("content_gap");
          for (const f of findings) {
            if (f.kind === "strategic") drafts.push({ source: "content_gap", f: { ...f, proposal: null, questions: [] } });
            else if (f.proposal) drafts.push({ source: "content_gap", f: { ...f, kind: "mechanical", questions: [] } });
          }
        }
      }
    }
  }

  if (drafts.length) {
    const rows = drafts.slice(0, 12).map(({ source, f }) => ({
      workspaceId,
      postId: post.id,
      source,
      kind: f.kind,
      title: f.title,
      detail: f.detail || null,
      proposal: f.proposal,
      anchor: f.anchor,
      questions: JSON.stringify(f.questions),
      fingerprint: fingerprintOf(source, f.title),
    }));
    // skipDuplicates on (postId, fingerprint): a dismissed or resolved finding
    // with the same fingerprint is left exactly as it is.
    const { count } = await db.blogFinding.createMany({ data: rows, skipDuplicates: true });
    result.created = count;
  }
  await writeAudit({
    workspaceId,
    action: "blog.findings_generated",
    entityType: "blog_post",
    entityId: post.id,
    meta: { created: result.created, ran: result.ran, skipped: result.skipped, via: opts?.via ?? "editor" },
  });
  return result;
}

// ---- Applying a proposal ----------------------------------------------------------

const H2 = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;

/**
 * Insert `html` at the end of the section headed by `anchor` (before the next
 * h2), or — with no anchor — before a closing FAQ / takeaways / conclusion
 * section if one exists, else at the end.
 */
export function insertProposal(body: string, html: string, anchor: string | null): string {
  const block = `\n${html}\n`;
  if (anchor) {
    const want = anchor.toLowerCase().replace(/\s+/g, " ").trim();
    for (const m of body.matchAll(H2)) {
      const text = stripTags(m[1]).toLowerCase();
      if (text === want || text.includes(want) || want.includes(text)) {
        const sectionStart = (m.index ?? 0) + m[0].length;
        const next = body.slice(sectionStart).search(/<h2[^>]*>/i);
        const at = next === -1 ? body.length : sectionStart + next;
        return body.slice(0, at) + block + body.slice(at);
      }
    }
  }
  for (const m of body.matchAll(H2)) {
    if (/frequently asked|key takeaways|conclusion|final thoughts/i.test(stripTags(m[1]))) {
      return body.slice(0, m.index) + block + body.slice(m.index);
    }
  }
  return body + block;
}

export async function applyFindingCore(
  workspaceId: string,
  findingId: string,
  opts: { actorId?: string | null; via: "editor" | "auto-review" },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const finding = await db.blogFinding.findFirst({ where: { id: findingId, workspaceId } });
  if (!finding) return { ok: false, reason: "not found" };
  if (!(finding.status === "open" || finding.status === "answered")) return { ok: false, reason: `already ${finding.status}` };
  if (!finding.proposal) return { ok: false, reason: "nothing to apply yet" };
  const post = await db.blogPost.findFirst({ where: { id: finding.postId, workspaceId } });
  if (!post?.body) return { ok: false, reason: "no article body" };
  if (post.protectedFromRewrite) return { ok: false, reason: "article is protected from rewrites" };

  // Same write discipline as the editor: a version first, block-nesting
  // repaired on the way in, one audit row.
  await db.blogPostVersion.create({ data: { postId: post.id, label: `before finding: ${finding.title.slice(0, 60)}`, body: post.body } });
  const nextBody = unwrapBlockParagraphs(insertProposal(post.body, finding.proposal, finding.anchor));
  await db.blogPost.update({ where: { id: post.id }, data: { body: nextBody } });
  await db.blogFinding.update({
    where: { id: finding.id },
    data: { status: "applied", resolvedAt: new Date(), resolvedById: opts.actorId ?? null },
  });
  await writeAudit({
    workspaceId,
    actorId: opts.actorId ?? undefined,
    action: "blog.finding_applied",
    entityType: "blog_post",
    entityId: post.id,
    meta: { findingId: finding.id, source: finding.source, kind: finding.kind, title: finding.title.slice(0, 120), via: opts.via },
  });
  return { ok: true };
}

// ---- Answering a knowledge card ---------------------------------------------------

/**
 * Save the author's answers, bank them in the Experts profile (the post's
 * expert, else the best match, else a profile created for the person
 * answering), then weave a proposal from them. The answers are the person's
 * own words and are stored before the model is involved at all.
 */
export async function answerFindingCore(
  workspaceId: string,
  findingId: string,
  answers: string[],
  actor: { id: string; name: string | null; email: string },
): Promise<{ ok: true; woven: boolean } | { ok: false; reason: string }> {
  const finding = await db.blogFinding.findFirst({ where: { id: findingId, workspaceId } });
  if (!finding || finding.kind !== "knowledge") return { ok: false, reason: "not a knowledge finding" };
  if (finding.status !== "open") return { ok: false, reason: `already ${finding.status}` };
  const post = await db.blogPost.findFirst({ where: { id: finding.postId, workspaceId } });
  if (!post) return { ok: false, reason: "article not found" };
  let questions: FindingQuestion[] = [];
  try { questions = JSON.parse(finding.questions) as FindingQuestion[]; } catch { questions = []; }
  const pairs = questions
    .map((q, i) => ({ ...q, a: (answers[i] ?? "").trim().slice(0, 2000) }))
    .filter((p) => p.a.length > 0);
  if (pairs.length === 0) return { ok: false, reason: "no answers given" };

  await db.blogFinding.update({
    where: { id: finding.id },
    data: { status: "answered", answers: JSON.stringify(pairs.map((p) => p.a)), resolvedById: actor.id },
  });

  // Bank the answers where drafting already reads: the Experts profile — the
  // post's own expert, else the best topic match, else a profile for the
  // person answering (they ARE the expert on what they just said).
  const pick = { id: true, answers: true, version: true } as const;
  let profile: { id: string; answers: string; version: number } | null = post.smeProfileId
    ? await db.smeProfile.findFirst({ where: { id: post.smeProfileId, workspaceId }, select: pick })
    : null;
  if (!profile) {
    const match = await selectSmeProfile(workspaceId, post);
    if (match) profile = await db.smeProfile.findFirst({ where: { id: match.id }, select: pick });
  }
  if (!profile) {
    profile = await db.smeProfile.create({
      data: {
        workspaceId,
        name: actor.name?.trim() || actor.email,
        topics: JSON.stringify(post.focusKeyword ? [post.focusKeyword] : []),
      },
      select: pick,
    });
  }
  const bank = parseAnswers(profile.answers);
  for (const p of pairs) {
    const line = `On “${post.title.slice(0, 80)}” — ${p.q}\n${p.a}`;
    bank[p.intakeId] = bank[p.intakeId] ? `${bank[p.intakeId]}\n\n${line}` : line;
  }
  await db.smeProfile.update({ where: { id: profile.id }, data: { answers: JSON.stringify(bank), version: profile.version + 1 } });
  if (!post.smeProfileId) await db.blogPost.update({ where: { id: post.id }, data: { smeProfileId: profile.id } });
  await writeAudit({
    workspaceId,
    actorId: actor.id,
    action: "blog.finding_answered",
    entityType: "blog_post",
    entityId: post.id,
    meta: { findingId: finding.id, answers: pairs.length, profileId: profile.id, intakeIds: pairs.map((p) => p.intakeId) },
  });

  const woven = await weaveFindingCore(workspaceId, finding.id);
  return { ok: true, woven };
}

/**
 * Turn saved answers into a proposed passage. Separate from answering so a
 * provider blip (mock reply) leaves the answers banked and offers a retry.
 */
export async function weaveFindingCore(workspaceId: string, findingId: string): Promise<boolean> {
  const finding = await db.blogFinding.findFirst({ where: { id: findingId, workspaceId } });
  if (!finding || finding.status !== "answered" || !finding.answers) return false;
  const post = await db.blogPost.findFirst({ where: { id: finding.postId, workspaceId } });
  if (!post?.body) return false;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  let questions: FindingQuestion[] = [];
  let answers: string[] = [];
  try { questions = JSON.parse(finding.questions); answers = JSON.parse(finding.answers); } catch { return false; }
  const headings = [...post.body.matchAll(H2)].map((m) => stripTags(m[1])).filter(Boolean);

  const res = await llm.complete({
    model: await resolveUsableModel(post.model ?? workspace?.defaultModel ?? llm.defaultModel, workspaceId),
    system:
      "You add the author's first-hand experience to a blog article. Given the article, a finding, and the author's own answers, write the passage that resolves the finding: two to five sentences of HTML (<p>, optionally one <h3>) in the article's voice — first person plural unless the answers are clearly personal. " +
      "Use ONLY facts in the answers; no numbers, names, tools or outcomes that are not in them. " +
      'Respond ONLY with JSON: {"proposal": string, "anchor": string} — anchor is the exact text of the existing h2 the passage belongs after, or "" for the end.',
    messages: [{
      role: "user",
      content: [
        `Article: "${post.title}"`,
        `Finding: ${finding.title}${finding.detail ? ` — ${finding.detail}` : ""}`,
        headings.length ? `Existing h2 headings: ${headings.join(" | ")}` : null,
        `Author's answers:\n${questions.map((q, i) => `Q: ${q.q}\nA: ${answers[i] ?? ""}`).filter((s) => !s.endsWith("A: ")).join("\n\n")}`,
        `Article text:\n${stripTags(post.body).slice(0, 2500)}`,
      ].filter(Boolean).join("\n\n"),
    }],
    maxTokens: 2000,
    timeoutMs: 120_000,
    workspaceId,
  });
  if (res.provider === "mock") {
    await db.blogFinding.update({ where: { id: finding.id }, data: { reason: "Answers saved; the AI provider was unavailable to write the passage — try Weave again." } });
    return false;
  }
  let parsed: { proposal?: unknown; anchor?: unknown } = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch { parsed = {}; }
  const proposal = cleanProposal(parsed.proposal);
  if (!proposal) {
    await db.blogFinding.update({ where: { id: finding.id }, data: { reason: "Answers saved; the passage came back empty — try Weave again." } });
    return false;
  }
  await db.blogFinding.update({
    where: { id: finding.id },
    data: { proposal, anchor: typeof parsed.anchor === "string" ? parsed.anchor.trim().slice(0, 150) || null : finding.anchor, reason: null },
  });
  return true;
}

// ---- Dismiss / add to ideas ------------------------------------------------------

export async function dismissFindingCore(workspaceId: string, findingId: string, actorId: string | null, reason: string): Promise<void> {
  await db.blogFinding.updateMany({
    where: { id: findingId, workspaceId, status: { in: ["open", "answered"] } },
    data: { status: "dismissed", reason: reason.slice(0, 300) || null, resolvedAt: new Date(), resolvedById: actorId },
  });
  await writeAudit({ workspaceId, actorId: actorId ?? undefined, action: "blog.finding_dismissed", entityType: "blog_finding", entityId: findingId, meta: { reason: reason.slice(0, 120) } });
}

export async function addFindingToIdeasCore(workspaceId: string, findingId: string, actorId: string | null): Promise<string | null> {
  const finding = await db.blogFinding.findFirst({ where: { id: findingId, workspaceId, status: "open" } });
  if (!finding) return null;
  const post = await db.blogPost.findFirst({ where: { id: finding.postId, workspaceId }, select: { focusKeyword: true, topicId: true } });
  const idea = await db.blogIdea.create({
    data: {
      workspaceId,
      title: finding.title,
      angle: finding.detail,
      keyword: post?.focusKeyword ?? null,
      topicId: post?.topicId ?? null,
      source: "finding",
    },
  });
  await db.blogFinding.update({ where: { id: finding.id }, data: { status: "added", resolvedAt: new Date(), resolvedById: actorId, reason: idea.id } });
  await writeAudit({ workspaceId, actorId: actorId ?? undefined, action: "blog.finding_added_to_ideas", entityType: "blog_idea", entityId: idea.id, meta: { findingId: finding.id, fromPost: finding.postId } });
  return idea.id;
}

// ---- Unattended (full autonomy) --------------------------------------------------

/**
 * What auto-review may do with findings on its own: generate them once per
 * article, and apply the MECHANICAL ones. Knowledge cards need a person;
 * strategic cards are a decision. Both wait in the editor.
 */
export async function autoFindingsCore(workspaceId: string, postId: string): Promise<{ generated: number; applied: number }> {
  const out = { generated: 0, applied: 0 };
  const existing = await db.blogFinding.count({ where: { postId } });
  if (existing === 0) {
    const already = await db.auditLog.count({ where: { workspaceId, action: "blog.findings_generated", entityId: postId } });
    if (already === 0) out.generated = (await generateFindingsCore(workspaceId, postId, { via: "auto-review" })).created;
  }
  const mechanical = await db.blogFinding.findMany({
    where: { postId, status: "open", kind: "mechanical", proposal: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  for (const f of mechanical) {
    const r = await applyFindingCore(workspaceId, f.id, { via: "auto-review" });
    if (r.ok) out.applied++;
  }
  return out;
}
