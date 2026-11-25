import fs from "node:fs";
import path from "node:path";
import { run } from "./proc";
import { looksSecret } from "./proof";
import { redact } from "./redact";

export const redactPatch = redact;

/** Files git would publish that contain something shaped like a secret. Pattern matching: it can miss some. */
export async function secretsIn(dir: string): Promise<string[]> {
  const r = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: dir, timeoutMs: 8000 });
  const out: string[] = [];
  for (const f of r.stdout.split("\0").filter(Boolean).slice(0, 2000)) {
    if (/package-lock|\.(png|jpe?g|webp|gif|ico|woff2?|ttf|mp[34]|pdf|zip)$/i.test(f)) continue;
    try {
      const full = path.join(dir, f);
      if (!fs.lstatSync(full).isFile() || fs.statSync(full).size > 400_000) continue;
      if (/(^|\/)\.env(?!\.example)/.test(f) || fs.readFileSync(full, "utf8").split("\n").some(looksSecret)) out.push(f);
    } catch {}
    if (out.length >= 5) break;
  }
  return out;
}
