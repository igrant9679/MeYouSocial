import { PrismaClient } from "@prisma/client";
import { sealSetting, openSetting } from "@/lib/keyring";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** The client without the keyring hook: stored values as they are. For the
 *  keyring's own sweep (lib/keyring-sweep.ts) and the Auth.js adapter. */
export const baseDb =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = baseDb;

// Secret settings are sealed on the way in and opened on the way out (E-SEC-04),
// for every query on Setting / WorkspaceSetting — getSetting and the pages that
// read the tables directly alike. Which keys are secrets: isSecretSetting.

type Loose = Record<string, unknown> | null | undefined;

function keyOf(args: Loose): string | null {
  const where = args?.where as Loose;
  const k = where?.key ?? (where?.workspaceId_key as Loose)?.key ?? (args?.data as Loose)?.key ?? (args?.create as Loose)?.key;
  return typeof k === "string" ? k : null;
}

function sealData(data: unknown, fallbackKey: string | null): unknown {
  if (Array.isArray(data)) return data.map((d) => sealData(d, fallbackKey));
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  const key = typeof d.key === "string" ? d.key : fallbackKey;
  if (!key) return data;
  if (typeof d.value === "string") return { ...d, value: sealSetting(key, d.value) };
  const set = (d.value as Loose)?.set;
  if (typeof set === "string") return { ...d, value: { set: sealSetting(key, set) } };
  return data;
}

function sealArgs<T>(args: T): T {
  const a = args as Loose;
  if (!a || typeof a !== "object") return args;
  const key = keyOf(a);
  const out: Record<string, unknown> = { ...a };
  for (const f of ["data", "create", "update"] as const) if (f in out) out[f] = sealData(out[f], key);
  return out as T;
}

function openRows<T>(res: T): T {
  const one = (r: unknown) => {
    if (r && typeof r === "object" && typeof (r as { value?: unknown }).value === "string") {
      (r as { value: string }).value = openSetting((r as { value: string }).value);
    }
  };
  if (Array.isArray(res)) res.forEach(one);
  else one(res);
  return res;
}

export const db = baseDb.$extends({
  name: "keyring",
  query: {
    setting: {
      async $allOperations({ args, query }) {
        return openRows(await query(sealArgs(args)));
      },
    },
    workspaceSetting: {
      async $allOperations({ args, query }) {
        return openRows(await query(sealArgs(args)));
      },
    },
  },
});
