/** Throwaway FIXTURE — DELETE AFTER. A workspace with real Company info prose
 *  and a blog post, to check the editors RENDER (the pane can't hydrate). */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
const bcrypt = await import("bcryptjs");
const email = `rt-probe-${randomBytes(3).toString("hex")}@example.test`;
const password = `Pw-${randomBytes(9).toString("base64url")}`;
const ws = await db.workspace.create({ data: { name: "Rich text probe" } });
const user = await db.user.create({ data: { email, name: "RT Probe", passwordHash: await bcrypt.hash(password, 10), emailVerified: new Date() } });
await db.membership.create({ data: { userId: user.id, workspaceId: ws.id, role: "ADMIN" } });
await db.orgProfile.create({
  data: { workspaceId: ws.id, industry: "Marketing", audience: "Nonprofits",
    description: "We do content-led SEO for nonprofits.\n\n- B Corps only\n- Quarterly ranking data" },
});
const src = await db.blogPost.findFirst({ where: { status: "published", body: { not: null } }, select: { body: true, title: true } });
const post = await db.blogPost.create({ data: { workspaceId: ws.id, title: `COPY — ${src?.title}`, body: src?.body ?? "<p>x</p>", status: "drafting", createdById: user.id } });
console.log(JSON.stringify({ workspaceId: ws.id, email, password, postId: post.id }, null, 1));
await db.$disconnect();
