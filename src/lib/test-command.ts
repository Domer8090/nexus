/** True when a shell command runs a project's tests. Checked on the full command, before it is shortened for display. */
const RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:-\S+\s+)*(?:test|t)\b|vitest|jest|mocha|pytest|unittest|node\s+--test|cargo\s+(?:test|nextest)|go\s+test|rspec|swift\s+test|xcodebuild\s+[^|;&]*\btest\b|playwright\s+test|deno\s+test|gradlew?\s+test|mvn\s+test|make\s+test)/i;
/** Commands that only mention a test tool (reading, searching or installing it). */
const ONLY_MENTIONS = /^\s*(?:cd\s+\S+\s*$|cat|grep|rg|ls|sed|head|tail|find|which|echo|git|(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ls)\b)/;

export function isTestCommand(cmd: string): boolean {
  return cmd.split(/&&|\|\||[;\n|]/).some((part) => RE.test(part) && !ONLY_MENTIONS.test(part));
}
