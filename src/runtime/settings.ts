import { kvGet, kvSet } from "./db";
import { expireHackathon } from "@/lib/modes";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export function getSettings(): Settings {
  const s = kvGet<Partial<Settings>>("settings") ?? {};
  const merged: Settings = { ...DEFAULT_SETTINGS, ...s, defaultPermissions: { ...DEFAULT_SETTINGS.defaultPermissions, ...(s.defaultPermissions ?? {}) } };
  const next = expireHackathon(merged, Date.now());
  if (next !== merged) kvSet("settings", next);
  return next;
}

export function saveSettings(patch: Partial<Settings>) {
  const next = { ...getSettings(), ...patch };
  next.concurrency = Math.max(1, Math.min(8, Math.round(next.concurrency)));
  kvSet("settings", next);
  return next;
}
