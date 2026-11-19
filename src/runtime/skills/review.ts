import type { ReviewFinding, ReviewOutcome, SkillReview } from "@/lib/types";

/**
 * Best-effort static review of a skill's files. It is pattern matching, not a guarantee.
 * The result always lists what was and was not checked.
 */

type Rule = { id: string; severity: ReviewFinding["severity"]; re: RegExp; detail: string; scriptsOnly?: boolean };

export const RULES: Rule[] = [
  { id: "pipe-to-shell", severity: "high", re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, detail: "Downloads a script and runs it straight away.", scriptsOnly: true },
  { id: "base64-exec", severity: "high", re: /base64\s+(-d|--decode)[^\n]*\|\s*(ba|z)?sh|eval\s*\(\s*(atob|Buffer\.from)\(/, detail: "Decodes hidden content and executes it." },
  { id: "credential-files", severity: "high", re: /(~|\$HOME|homedir\(\))[^\n]{0,40}\/\.(ssh|aws|gnupg|netrc|docker\/config\.json|config\/gh)|id_rsa|id_ed25519|\.aws\/credentials/, detail: "Reads credential files." },
  { id: "keychain", severity: "high", re: /security\s+(find|dump)-(generic|internet)-password|dump-keychain|secret-tool\s+lookup/, detail: "Reads the system keychain." },
  { id: "env-exfil", severity: "high", re: /(printenv|\benv\b|process\.env|os\.environ)[^\n]{0,80}(curl|wget|fetch\(|requests\.(post|put)|https?:\/\/)/, detail: "Sends environment variables over the network." },
  { id: "destructive-rm", severity: "high", re: /rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$|\/\*)/, detail: "Deletes the home folder or root." },
  { id: "network", severity: "medium", re: /\b(curl|wget)\s+|\bfetch\(\s*["'`]https?:|requests\.(get|post)\(|urllib\.request|http\.request\(|axios\.(get|post)\(/, detail: "Makes network requests.", scriptsOnly: true },
  { id: "process-spawn", severity: "medium", re: /child_process|subprocess\.(run|Popen|call)|os\.system\(|execSync\(|spawnSync\(/, detail: "Starts other programs.", scriptsOnly: true },
  { id: "sudo", severity: "medium", re: /(^|\s)sudo\s+/, detail: "Asks for administrator rights.", scriptsOnly: true },
  { id: "package-install", severity: "medium", re: /\b(npm|pnpm|yarn)\s+(i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b/, detail: "Installs packages.", scriptsOnly: true },
  { id: "writes-home", severity: "medium", re: />\s*(~|\$HOME)\/|writeFileSync\([^)]*(homedir|HOME)/, detail: "Writes files outside the project.", scriptsOnly: true },
  { id: "obfuscation", severity: "medium", re: /[A-Za-z0-9+/]{400,}={0,2}/, detail: "Contains a long encoded blob that can hide code." },
];

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd)$/i;

export function isScript(p: string) {
  return SCRIPT_EXT.test(p);
}

export function reviewFiles(
  files: { path: string; content: string | null; size: number }[],
  meta: { hasHooks: boolean; allowedTools: string[]; license: string | null; totalFiles: number },
): SkillReview {
  const findings: ReviewFinding[] = [];
  let scanned = 0;
  let binary = 0;
  let large = 0;
  for (const f of files) {
    if (f.content == null) {
      if (f.size > 200_000) large++;
      else binary++;
      continue;
    }
    scanned++;
    const script = isScript(f.path);
    const lines = f.content.split("\n");
    for (const rule of RULES) {
      if (rule.scriptsOnly && !script) continue;
      for (let i = 0; i < lines.length; i++) {
        if (rule.re.test(lines[i])) {
          findings.push({ severity: rule.severity, file: f.path, line: i + 1, rule: rule.id, detail: rule.detail });
          break;
        }
      }
    }
    if (script && lines.some((l) => l.length > 2000)) findings.push({ severity: "medium", file: f.path, rule: "minified", detail: "Has very long lines, typical of minified or generated code that is hard to review." });
    if (script) findings.push({ severity: "low", file: f.path, rule: "script", detail: "Contains an executable script." });
  }
  if (meta.hasHooks) findings.push({ severity: "medium", file: "SKILL.md", rule: "hooks", detail: "Declares hooks that run commands automatically when the agent stops or starts." });
  if (meta.allowedTools.some((t) => /^bash|^\*/i.test(t))) findings.push({ severity: "low", file: "SKILL.md", rule: "allowed-tools", detail: `Pre-approves tools: ${meta.allowedTools.join(", ")}.` });
  if (!meta.license) findings.push({ severity: "low", file: "(repository)", rule: "license", detail: "No license detected on the repository." });

  // Credential reads combined with network use in the same file is treated as exfiltration risk.
  const byFile = new Map<string, Set<string>>();
  for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? new Set()).add(f.rule));
  const exfil = [...byFile.values()].some((r) => (r.has("credential-files") || r.has("keychain")) && (r.has("network") || r.has("env-exfil")));

  let outcome: ReviewOutcome;
  if (exfil || findings.some((f) => f.rule === "env-exfil" || f.rule === "destructive-rm")) outcome = "blocked";
  else if (findings.some((f) => f.severity === "high" || f.severity === "medium") || !meta.license || binary + large > 0 || files.length < meta.totalFiles) outcome = "review-required";
  else outcome = "reviewed";

  const notChecked = ["What the skill's instructions make the agent do at run time", "Anything the scripts download later"];
  if (binary) notChecked.push(`${binary} binary file${binary === 1 ? "" : "s"}`);
  if (large) notChecked.push(`${large} file${large === 1 ? "" : "s"} over 200 KB`);
  if (files.length < meta.totalFiles) notChecked.push(`${meta.totalFiles - files.length} file${meta.totalFiles - files.length === 1 ? "" : "s"} beyond the first ${files.length}`);

  return {
    outcome,
    findings,
    checked: [
      `${scanned} text file${scanned === 1 ? "" : "s"} matched against ${RULES.length} risk patterns`,
      "SKILL.md frontmatter: hooks and allowed tools",
      "Repository license",
      "File types (scripts vs. documents)",
    ],
    notChecked,
    reviewedAt: new Date().toISOString(),
    filesScanned: scanned,
  };
}
