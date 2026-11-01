import { readJson } from "@/lib/db/json";

/**
 * The steps between a finished script and a live video (E-VID-04), in order.
 * Every tick is a person's: nothing in the app records that a video was
 * filmed or captioned, and a script's status never leaves "draft", so no step
 * is ticked on the app's say-so.
 */
export const UPLOAD_STEPS = [
  { key: "script", label: "Script final" },
  { key: "recorded", label: "Recorded" },
  { key: "edited", label: "Edited" },
  { key: "thumbnail", label: "Thumbnail" },
  { key: "metadata", label: "Title, description and tags" },
  { key: "captions", label: "Captions" },
  { key: "uploaded", label: "Uploaded" },
] as const;

export type UploadStep = (typeof UPLOAD_STEPS)[number]["key"];
/** Ticked steps: when, and the user id of who ticked it. */
export type UploadChecklist = Partial<Record<UploadStep, { at: string; by: string }>>;

const KEYS: ReadonlySet<string> = new Set(UPLOAD_STEPS.map((s) => s.key));
export const isUploadStep = (k: string): k is UploadStep => KEYS.has(k);

/** The ticked steps in `ContentProject.uploadChecklist`; anything unknown or malformed is dropped. */
export function readChecklist(raw: string | null | undefined): UploadChecklist {
  const parsed = readJson<unknown>(raw, {});
  const out: UploadChecklist = {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isUploadStep(k) || !v || typeof v !== "object") continue;
    const { at, by } = v as { at?: unknown; by?: unknown };
    if (typeof at === "string") out[k] = { at, by: typeof by === "string" ? by : "" };
  }
  return out;
}

export const checklistDone = (c: UploadChecklist): number => UPLOAD_STEPS.filter((s) => c[s.key]).length;
