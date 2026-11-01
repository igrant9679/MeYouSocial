import { baseDb } from "@/lib/db";
import { keyring, openWith, seal, isSecretSetting, isSealedSetting, parseSealedSetting, sealSetting, type Sealed } from "@/lib/keyring";

/**
 * Where every stored secret stands against the keyring, and the operator's
 * re-encrypt (E-SEC-04). Reads raw values through `baseDb` — the keyring hook
 * on `db` would hand back the plain text and hide which key a value is under.
 *
 * ⚠ Re-encrypting writes LSI's and CF's secrets. It is the operator's button on
 * Settings → Keyring, never run unattended; each row is replaced only if it
 * still holds the value that was read (a save in between wins).
 */

export type SecretPlace = "settings" | "oauth" | "wordpress" | "two_factor";
export type SecretState = "current" | "older" | "unlabelled" | "plain" | "unreadable";
export type SecretRow = {
  place: SecretPlace;
  /** What it is, for the page: a setting key, "WordPress password", "two-factor secret". */
  label: string;
  workspaceId: string | null;
  state: SecretState;
  kid: string | null;
  write: () => Promise<boolean>;
};

const SETTING_SHAPES = [
  { key: { startsWith: "api_key:" } }, { key: { endsWith: ":api_key" } }, { key: { endsWith: ":client_secret" } },
  { key: { endsWith: ":webhook_secret" } }, { key: { endsWith: ":service_account" } }, { key: { endsWith: ":password" } },
  { key: "email:smtp" }, { key: { endsWith: ":refresh_token" } },
];

function stateOfJson(raw: string): { state: SecretState; kid: string | null; plain: string | null } {
  let enc: Sealed;
  try { enc = JSON.parse(raw) as Sealed; } catch { return { state: "unreadable", kid: null, plain: null }; }
  const got = enc && typeof enc === "object" ? openWith(enc) : null;
  if (!got) return { state: "unreadable", kid: enc?.kid ?? null, plain: null };
  if (!enc.kid) return { state: "unlabelled", kid: got.kid, plain: got.plain };
  return { state: got.kid === keyring().current?.id ? "current" : "older", kid: got.kid, plain: got.plain };
}

function stateOfSetting(raw: string): { state: SecretState; kid: string | null; plain: string | null } {
  if (!isSealedSetting(raw)) return { state: "plain", kid: null, plain: raw };
  const s = parseSealedSetting(raw);
  const got = s ? openWith(s) : null;
  if (!got) return { state: "unreadable", kid: s?.kid ?? null, plain: null };
  return { state: got.kid === keyring().current?.id ? "current" : "older", kid: got.kid, plain: got.plain };
}

/** Every stored secret, with what re-encrypting it would write. */
export async function secretRows(): Promise<SecretRow[]> {
  const [globals, perWs, wp, users] = await Promise.all([
    baseDb.setting.findMany({ where: { OR: SETTING_SHAPES, NOT: { value: "" } }, select: { key: true, value: true } }),
    baseDb.workspaceSetting.findMany({ where: { OR: SETTING_SHAPES, NOT: { value: "" } }, select: { workspaceId: true, key: true, value: true } }),
    baseDb.wordPressConnection.findMany({ select: { id: true, workspaceId: true, encAppPassword: true } }),
    baseDb.user.findMany({ where: { totpSecret: { not: null } }, select: { id: true, totpSecret: true } }),
  ]);
  const rows: SecretRow[] = [];
  const settingRow = (workspaceId: string | null, key: string, value: string) => {
    const json = key.endsWith(":refresh_token");
    if (!json && !isSecretSetting(key)) return;
    const st = json ? stateOfJson(value) : stateOfSetting(value);
    const next = () => (json ? JSON.stringify(seal(st.plain ?? "")) : sealSetting(key, st.plain ?? ""));
    rows.push({
      place: json ? "oauth" : "settings", label: key, workspaceId, state: st.state, kid: st.kid,
      write: async () => {
        const value2 = next();
        const r = workspaceId
          ? await baseDb.workspaceSetting.updateMany({ where: { workspaceId, key, value }, data: { value: value2 } })
          : await baseDb.setting.updateMany({ where: { key, value }, data: { value: value2 } });
        return r.count === 1;
      },
    });
  };
  for (const s of globals) settingRow(null, s.key, s.value);
  for (const s of perWs) settingRow(s.workspaceId, s.key, s.value);
  for (const c of wp) {
    const st = stateOfJson(c.encAppPassword);
    rows.push({
      place: "wordpress", label: "WordPress password", workspaceId: c.workspaceId, state: st.state, kid: st.kid,
      write: async () => (await baseDb.wordPressConnection.updateMany({ where: { id: c.id, encAppPassword: c.encAppPassword }, data: { encAppPassword: JSON.stringify(seal(st.plain ?? "")) } })).count === 1,
    });
  }
  for (const u of users) {
    const st = stateOfJson(u.totpSecret ?? "");
    rows.push({
      place: "two_factor", label: "two-factor secret", workspaceId: null, state: st.state, kid: st.kid,
      write: async () => (await baseDb.user.updateMany({ where: { id: u.id, totpSecret: u.totpSecret }, data: { totpSecret: JSON.stringify(seal(st.plain ?? "")) } })).count === 1,
    });
  }
  return rows;
}

/** What re-encrypting moves: anything readable that isn't already under the current key. */
export const needsWrite = (r: SecretRow) => r.state === "older" || r.state === "unlabelled" || r.state === "plain";

export type SweepResult = { written: number; skipped: number; unreadable: number; byWorkspace: Map<string | null, number> };

export async function reencryptAll(): Promise<SweepResult> {
  if (!keyring().current) throw new Error("TOKEN_ENCRYPTION_KEY is not set — there is no key to encrypt with.");
  const rows = await secretRows();
  const out: SweepResult = { written: 0, skipped: 0, unreadable: rows.filter((r) => r.state === "unreadable").length, byWorkspace: new Map() };
  for (const r of rows.filter(needsWrite)) {
    let ok = false;
    try { ok = await r.write(); } catch (e) { console.warn(`[keyring] re-encrypt of ${r.label} failed:`, e instanceof Error ? e.message : e); }
    if (ok) {
      out.written++;
      out.byWorkspace.set(r.workspaceId, (out.byWorkspace.get(r.workspaceId) ?? 0) + 1);
    } else out.skipped++;
  }
  return out;
}
