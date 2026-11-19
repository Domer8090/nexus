/**
 * Reads when a usage limit resets from the agent's own message, for example Claude Code's
 * "You've hit your 5-hour limit · resets 11:40pm (America/Los_Angeles)" or Codex's
 * "try again in 2 hours 13 minutes" / "Try again at 3:05 PM". Returns null when the message
 * doesn't say; Nexus never guesses a reset time.
 */

/** UTC milliseconds for a wall-clock time in an IANA time zone, on the date that zone shows for `dayOf`. */
function zonedToUtc(tz: string, dayOf: number, hour: number, minute: number, addDays = 0): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(dayOf))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day + addDays, hour, minute);
  // Offset of the zone at that moment: how far its wall clock is from UTC.
  const probe = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(asUtc))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+probe.year, +probe.month - 1, +probe.day, +probe.hour, +probe.minute);
  return asUtc - (wall - asUtc);
}

export function parseReset(text: string | null | undefined, now = Date.now(), localTz = Intl.DateTimeFormat().resolvedOptions().timeZone): number | null {
  if (!text) return null;
  const rel = text.match(/try again in\s+(?:(\d+)\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d+)\s*(?:minutes?|mins?|m)\b)?/i);
  if (rel && (rel[1] || rel[2])) return now + ((+(rel[1] ?? 0) * 60 + +(rel[2] ?? 0)) * 60 + 30) * 1000;
  const abs = text.match(/(?:resets?(?:\s+at)?|try again at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z_]+)+|UTC)\))?/i);
  if (!abs) return null;
  let hour = +abs[1] % 12;
  if (abs[3].toLowerCase() === "pm") hour += 12;
  const minute = +(abs[2] ?? 0);
  let tz = abs[4] ?? localTz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = localTz;
  }
  let at = zonedToUtc(tz, now, hour, minute);
  if (at <= now) at = zonedToUtc(tz, now, hour, minute, 1);
  // A minute of slack so the provider's window has really rolled over.
  return at + 60_000;
}
