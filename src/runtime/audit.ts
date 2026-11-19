import { getDb } from "./db";
import { redact } from "./redact";

/** Local audit trail. Secrets are redacted before writing. */
export function audit(action: string, detail: string) {
  getDb().prepare("INSERT INTO audit (at, action, detail) VALUES (?, ?, ?)").run(new Date().toISOString(), action, redact(detail));
}

export function recentAudit(limit = 100) {
  return getDb().prepare("SELECT id, at, action, detail FROM audit ORDER BY id DESC LIMIT ?").all(limit) as { id: number; at: string; action: string; detail: string }[];
}
