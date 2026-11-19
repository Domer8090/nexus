/**
 * Redaction for anything Nexus logs or shows: tokens, keys, bearer headers, emails.
 * Applied to command previews, stderr, audit entries and agent events.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[redacted-key]"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted-token]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted-token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]"],
  [/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',]+/gi, "$1[redacted]"],
  [/\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*[^\s"']+/g, "$1=[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /key|token|secret|password|email|org_?id|account/i.test(k) && typeof v === "string" ? "[redacted]" : redactDeep(v);
    }
    return out as T;
  }
  return value;
}
