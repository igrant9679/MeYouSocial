import { db } from "@/lib/db";
import { getSetting, setWorkspaceSetting, invalidateSettingsCache } from "@/lib/settings";

// SMTP configuration stored in-app instead of Railway env vars. Multi-tenant:
// each workspace can save its OWN SMTP credentials (WorkspaceSetting
// "email:smtp"); the global Setting row is the platform fallback, used both by
// workspaces without their own config and by app-level mail (password reset /
// verification, which have no workspace context).
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

function parse(value: string): SmtpConfig | null {
  try {
    const obj = JSON.parse(value) as Partial<SmtpConfig>;
    if (obj.host && obj.port && obj.user && obj.fromEmail) {
      return {
        host: obj.host,
        port: Number(obj.port),
        secure: Boolean(obj.secure),
        user: obj.user,
        pass: obj.pass ?? "",
        fromName: obj.fromName ?? "",
        fromEmail: obj.fromEmail,
      };
    }
  } catch {
    // malformed — treat as unconfigured
  }
  return null;
}

/** Workspace's own config → platform config → null. Cached in the settings layer. */
export async function getSmtpConfig(workspaceId?: string | null): Promise<SmtpConfig | null> {
  const value = await getSetting(SETTING_KEY, workspaceId);
  return value ? parse(value) : null;
}

export async function saveSmtpConfig(cfg: SmtpConfig, workspaceId?: string | null): Promise<void> {
  if (workspaceId) {
    await setWorkspaceSetting(workspaceId, SETTING_KEY, JSON.stringify(cfg));
    return;
  }
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(cfg) },
    create: { key: SETTING_KEY, value: JSON.stringify(cfg) },
  });
  invalidateSettingsCache();
}

export async function clearSmtpConfig(workspaceId?: string | null): Promise<void> {
  if (workspaceId) {
    await setWorkspaceSetting(workspaceId, SETTING_KEY, "");
    return;
  }
  await db.setting.deleteMany({ where: { key: SETTING_KEY } });
  invalidateSettingsCache();
}

export function maskPassword(p: string): string {
  if (!p) return "";
  if (p.length <= 4) return "•".repeat(p.length);
  return "•".repeat(p.length);
}
