/**
 * Sorts an agent's failure message into a kind the UI and the scheduler can act on.
 * Client-safe: used by the run page to explain a failure and by the runtime to hand a step off.
 */

export type FailureKind = "sign-in" | "limit" | "missing" | "network" | "other";

const SIGN_IN = /failed to authenticate|not logged in|not signed in|log ?in again|sign ?in again|login (has )?expired|login reached its time limit|sign-in expired|unauthori[sz]ed|\b401\b|invalid (api key|credentials)|auth(entication)? (error|required)|please run .*(auth )?login/i;
const LIMIT = /usage limit|rate[ -]?limit|quota|limit reached|limit exceeded|\b429\b|too many requests|out of (credits|usage)|hit your limit|try again (later|in)/i;
const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|getaddrinfo|socket hang up|fetch failed|network (error|is unreachable|connection)|connection (error|reset|closed|lost)|could not resolve host|no internet|you are offline|stream disconnected/i;
const MISSING = /command not found|not installed|ENOENT|no such file or directory.*(claude|codex|ollama)|model .* not found|pull the model|no model pulled/i;

export function classifyFailure(error: string | null | undefined): FailureKind {
  if (!error) return "other";
  if (SIGN_IN.test(error)) return "sign-in";
  if (LIMIT.test(error)) return "limit";
  if (NETWORK.test(error)) return "network";
  if (MISSING.test(error)) return "missing";
  return "other";
}

/** True when another agent might succeed where this one failed. */
export const canHandOff = (kind: FailureKind) => kind === "sign-in" || kind === "limit" || kind === "missing";
