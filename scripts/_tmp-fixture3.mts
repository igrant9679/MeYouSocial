import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const db = new PrismaClient();
const email = "qa-reply-check@example.invalid";
const password = randomBytes(12).toString("base64url");
const LSI = "cmrvqpm3i0000vq8k9lbzzwrb";

await db.user.deleteMany({ where: { email } });
const user = await db.user.create({
  data: {
    email, name: "Reply QA (temporary)",
    passwordHash: await bcrypt.hash(password, 10),
    emailVerified: new Date(),
    // EDITOR first: LSI has require_approval on, so this proves the governance
    // lock. Promoted to ADMIN below in a second run to prove the box appears.
    memberships: { create: [{ workspaceId: LSI, role: "EDITOR" }] },
  },
});
console.log("EMAIL=" + email);
console.log("PASSWORD=" + password);
console.log("role=EDITOR id=" + user.id);

// What a foreign account id looks like, for the tenancy negative test.
const foreign = await db.zernioAccount.findFirst({
  where: { workspaceId: "cms3pkgjb0028s23tohut6as9", platform: "facebook" },
  select: { accountId: true },
});
console.log("CF_FOREIGN_ACCOUNT_ID=" + foreign?.accountId);
console.log("require_approval(LSI)=" + (await db.workspaceSetting.findFirst({ where: { workspaceId: LSI, key: "social:require_approval" } }))?.value);

await db.$disconnect();
process.exit(0);
