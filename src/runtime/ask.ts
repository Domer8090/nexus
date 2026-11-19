import fs from "node:fs";
import path from "node:path";
import { bestModel } from "@/lib/model-pick";
import { canLaunch, detectAll } from "./agents/registry";
import { localJson, localModels, pickLight } from "./intake";
import { newId } from "./ids";
import { nexusHome } from "./paths";
import type { AgentStatus, SessionRole } from "@/lib/types";

/**
 * "Ask the agents": one request plus optional images. The light local model reads the request and
 * picks which ready agent should do it and how big the job is; Nexus turns that into a model with
 * the same rules as everywhere else. Without Ollama, plain rules pick instead, and the result says so.
 */

export type Pick = { agentId: string; agentName: string; model: string | null; role: SessionRole; why: string; by: "ollama" | "rules" };

const IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE = 8 * 1024 * 1024;

/** Saves pasted or uploaded images under ~/.nexus/attachments/<id>/, never inside the project. */
export function saveImages(images: string[]): string[] {
  if (!images.length) return [];
  const dir = path.join(nexusHome(), "attachments", newId("att"));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return images.map((d, i) => {
    const m = d.match(IMAGE);
    if (!m) throw new Error("Only PNG, JPEG, WebP or GIF images can be attached.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMAGE) throw new Error("Each image must be under 8 MB.");
    const file = path.join(dir, `image-${i + 1}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    return file;
  });
}

const SCHEMA = {
  type: "object",
  properties: { agent: { type: "string" }, size: { type: "string", enum: ["small", "large"] }, why: { type: "string" } },
  required: ["agent", "size", "why"],
};

function fitsRequest(a: AgentStatus, hasImages: boolean) {
  if (!canLaunch(a) || !a.nexusCapabilities.includes("edits-project")) return false;
  // Ollama gets no image input from Nexus, so image requests go to an account agent.
  return !hasImages || a.kind !== "local-runtime";
}

export async function pickAgent(request: string, hasImages: boolean, set: { claudeModel?: string | null; codexModel?: string | null }): Promise<Pick> {
  const ready = (await detectAll()).filter((a) => fitsRequest(a, hasImages));
  if (!ready.length) throw new Error(hasImages ? "No signed-in agent that can read images and edit files. Sign in to Claude Code or Codex in Agents." : "No agent is ready to edit files. Check Agents.");
  const result = (a: AgentStatus, size: "small" | "large", why: string, by: Pick["by"]): Pick => {
    let model = bestModel(a, "build", set);
    if (a.id === "claude-code" && !set.claudeModel) model = size === "large" ? "opus" : "sonnet";
    return { agentId: a.id, agentName: a.displayName, model, role: "solo", why, by };
  };
  const models = await localModels();
  const light = models?.length ? pickLight(models) : null;
  if (light && ready.length) {
    try {
      const list = ready.map((a) => `- ${a.id}: ${a.displayName}${a.kind === "local-runtime" ? " (local model on this laptop, slower and weaker, free)" : " (account agent, strong at real code)"}`).join("\n");
      const out = await localJson<{ agent: string; size: "small" | "large"; why: string }>(
        light,
        "You route a coding request to one agent. Pick an id from the list only. size is large for multi-file features, new screens, refactors or anything with images; small for copy, styling tweaks or one-file fixes. why is one short sentence for the user.",
        `Agents:\n${list}\n\nRequest${hasImages ? " (with screenshots attached)" : ""}:\n${request.slice(0, 4000)}`,
        SCHEMA,
        30_000,
      );
      const a = ready.find((x) => x.id === out.agent);
      if (a) return result(a, out.size === "large" ? "large" : "small", out.why.slice(0, 240), "ollama");
    } catch {}
  }
  const a = ready.find((x) => x.kind !== "local-runtime") ?? ready[0];
  const large = hasImages || request.length > 400 || /\b(feature|screen|page|refactor|build|app)\b/i.test(request);
  return result(a, large ? "large" : "small", light ? "The local model didn't answer, so Nexus used its rules: the first signed-in account agent." : "Ollama isn't running, so Nexus used its rules: the first signed-in account agent.", "rules");
}
