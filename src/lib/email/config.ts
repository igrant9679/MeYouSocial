import { db } from "@/lib/db";

// SMTP configuration stored in the Setting table so admins can manage it
// in-app instead of editing Railway env vars. Same pattern as LLM API keys.
//
// We DON'T store the password in plaintext beyond what the DB already exposes;
// treat the DB row as a secret (same trust level as the env vars it replaces).

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;        // true = TLS, false = STARTTLS
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
};

const SETTING_KEY = "email:smtp";
const CACHE_TTL_MS = 30_000;
let cache: { value: SmtpConfig | null; expires: number } | null = null;

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  if (cache && cache.expires > Date.now()) return cache.value;
  let parsed: SmtpConfig | null = null;
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row?.value) {
      const obj = JSON.parse(row.value) as Partial<SmtpConfig>;
      if (obj.host && obj.port && obj.user && obj.fromEmail) {
        parsed = {
          host: obj.host,
          port: Number(obj.port),
          secure: Boolean(obj.secure),
          user: obj.user,
          pass: obj.pass ?? "",
          fromName: obj.fromName ?? "",
          fromEmail: obj.fromEmail,
        };
      }
    }
  } catch {
    // DB unreachable — treat as unconfigured.
  }
  cache = { value: parsed, expires: Date.now() + CACHE_TTL_MS };
  return parsed;
}

export async function saveSmtpConfig(cfg: SmtpConfig): Promise<void> {
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(cfg) },
    create: { key: SETTING_KEY, value: JSON.stringify(cfg) },
  });
  cache = null;
}

export async function clearSmtpConfig(): Promise<void> {
  await db.setting.deleteMany({ where: { key: SETTING_KEY } });
  cache = null;
}

export function maskPassword(p: string): string {
  if (!p) return "";
  if (p.length <= 4) return "•".repeat(p.length);
  return "•".repeat(p.length);
}
