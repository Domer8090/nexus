import { kvGet, kvSet } from "./db";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export function getSettings(): Settings {
  const s = kvGet<Partial<Settings>>("settings") ?? {};
  return { ...DEFAULT_SETTINGS, ...s, defaultPermissions: { ...DEFAULT_SETTINGS.defaultPermissions, ...(s.defaultPermissions ?? {}) } };
}

export function saveSettings(patch: Partial<Settings>) {
  const next = { ...getSettings(), ...patch };
  next.concurrency = Math.max(1, Math.min(8, Math.round(next.concurrency)));
  kvSet("settings", next);
  return next;
}
