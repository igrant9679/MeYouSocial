// One-off admin password reset.
//
// Sets (or resets) the password for an admin/user account directly in the DB,
// bypassing email. Use when you're locked out and password-reset email isn't
// wired up.
//
// USAGE (run where DATABASE_URL points at the target DB — e.g. via Railway):
//
//   # password from an env var (preferred — keeps it out of shell history):
//   NEW_ADMIN_PASSWORD='your-strong-pass' node scripts/set-admin-password.mjs
//
//   # or as an argument:
//   node scripts/set-admin-password.mjs 'your-strong-pass'
//
//   # target a specific email (defaults to BOOTSTRAP_ADMIN_EMAIL):
//   node scripts/set-admin-password.mjs 'your-strong-pass' someone@example.com
//
//   # with the Railway CLI, so DATABASE_URL is injected automatically:
//   railway run node scripts/set-admin-password.mjs 'your-strong-pass'
//
// It will NOT create a user — only update an existing one — and prints just the
// email + a masked confirmation, never the password.

import { readFileSync } from "node:fs";

// Load .env if present (no-op when vars already set, e.g. under `railway run`).
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env) && v !== "") process.env[m[1]] = v;
  }
} catch { /* no .env — that's fine under railway run */ }

const password = process.env.NEW_ADMIN_PASSWORD ?? process.argv[2];
const targetEmail = (process.argv[3] ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "you@example.com").toLowerCase();

if (!password || password.length < 8) {
  console.error("✗ Provide a password of 8+ chars via NEW_ADMIN_PASSWORD or as the first argument.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL is not set. Run under `railway run`, or set it in .env / the shell.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const bcrypt = (await import("bcryptjs")).default;
const db = new PrismaClient();

try {
  const user = await db.user.findUnique({ where: { email: targetEmail } });
  if (!user) {
    console.error(`✗ No user found for ${targetEmail}.`);
    const all = await db.user.findMany({ select: { email: true } });
    console.error("  Existing users:", all.map((u) => u.email).join(", ") || "(none)");
    process.exit(2);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });
  console.log(`✓ Password updated for ${user.email}. You can sign in with the new password now.`);
} finally {
  await db.$disconnect();
}
