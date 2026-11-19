import type { Domain } from "@/lib/intake";
import { wantsImages } from "@/lib/intake";
import type { AgentStatus, SessionRole } from "@/lib/types";
import { canLaunch } from "./agents/registry";
import { bestModel } from "@/lib/model-pick";

/**
 * Team ("swarm") planner. Deterministic and explainable: it gives each job to the ready agent
 * whose capabilities fit it best, and says why. It never assigns a job to an agent that is not
 * installed, signed in and launchable from Nexus.
 *
 *   local model  -> plan + copy (cheap, private, runs in parallel)
 *   image agent  -> generated images into the shared worktree
 *   best coder   -> the build, in the same worktree, with everyone's output as context
 *   another model-> review of the build diff (a second opinion from a different vendor when possible)
 */

export type SwarmStep = {
  role: SessionRole;
  agentId: string;
  model: string | null;
  title: string;
  brief: string;
  afterIndexes: number[];
  shareWorktreeOfIndex: number | null;
  optional: boolean;
  why: string;
};

export type SwarmPlan = { steps: SwarmStep[]; notes: string[] };

const VISUAL: Domain[] = ["website", "webapp", "mobile", "game"];

export function planSwarm(input: {
  goal: string;
  brief: string;
  domain: Domain;
  answers: Record<string, string>;
  agents: AgentStatus[];
  lightModel: string | null;
  claudeModel: string | null;
  codexModel?: string | null;
}): SwarmPlan {
  const ready = input.agents.filter(canLaunch);
  const editors = ready.filter((a) => a.nexusCapabilities.includes("edits-project"));
  const coder = editors.find((a) => a.id === "claude-code") ?? editors[0];
  const imager = ready.find((a) => a.nexusCapabilities.includes("images"));
  const local = ready.find((a) => a.kind === "local-runtime" && a.models.length);
  const notes: string[] = [];
  if (!coder) return { steps: [], notes: ["No installed, signed-in agent can edit files. Set up Claude Code or Codex in Agents."] };

  const name = (a: AgentStatus) => a.displayName;
  const model = (a: AgentStatus, role: SessionRole) => bestModel(a, role, { claudeModel: input.claudeModel, codexModel: input.codexModel });
  const steps: SwarmStep[] = [];
  const visual = VISUAL.includes(input.domain);
  const look = input.answers.look ? `, matching this look: ${input.answers.look}` : "";

  let planIdx: number | null = null;
  let copyIdx: number | null = null;
  let imgIdx: number | null = null;

  // Images first: it is the slowest job, so it gets a slot before the local steps.
  if (wantsImages(input.answers, input.goal)) {
    if (imager) {
      imgIdx = steps.length;
      const n = input.domain === "game" ? 4 : input.domain === "website" ? 3 : 2;
      steps.push({
        role: "assets",
        agentId: imager.id,
        model: model(imager, "assets"),
        title: "Generate images",
        brief: `Generate ${n} images for the project described below with your image generation tool, in one consistent style${look}. Save each as a PNG in assets/images/ with a short kebab-case name (for example assets/images/hero.png). Do not create or change any other files. Finish with a list of every file you saved and what it shows.\n\n${input.brief}`,
        afterIndexes: [],
        shareWorktreeOfIndex: null,
        optional: true,
        why: `${name(imager)} is the only ready agent that generates images (it uses your ChatGPT sign-in).`,
      });
    } else {
      notes.push("You asked for images, but no signed-in agent here can generate them. The builder will draw icons and illustrations in code (SVG). Sign in to Codex CLI with ChatGPT to add generated images.");
    }
  }

  if (local) {
    planIdx = steps.length;
    steps.push({
      role: "plan",
      agentId: local.id,
      model: model(local, "plan"),
      title: "Plan the build",
      brief: `You coordinate a team of AI coding agents. Write a short build plan for the task below: the files to create, the parts of each, and the order. Do not write code. Under 250 words.\n\n${input.brief}`,
      afterIndexes: [],
      shareWorktreeOfIndex: null,
      optional: true,
      why: `${name(local)} plans on this machine: private, no account usage.`,
    });
    if (visual || input.domain === "docs") {
      copyIdx = steps.length;
      steps.push({
        role: "copy",
        agentId: local.id,
        model: model(local, "copy"),
        title: "Write the copy",
        brief: `Write the user-facing text for the task below: title, headings, short paragraphs, button labels, empty states and error messages. Plain Markdown grouped by page or section. Do not write code.\n\n${input.brief}`,
        afterIndexes: [],
        shareWorktreeOfIndex: null,
        optional: true,
        why: `${name(local)} drafts the words locally while the others work.`,
      });
    }
  } else notes.push("No local model is ready, so the builder plans and writes its own copy. Start Ollama with a model to add a local planner.");

  const deps = [planIdx, copyIdx, imgIdx].filter((x): x is number => x != null);
  const buildIdx = steps.length;
  const context = [
    planIdx != null && "follow the plan",
    copyIdx != null && "use the written copy where it fits",
    imgIdx != null && "use the images already saved in assets/images/ (list the folder first)",
  ].filter(Boolean);
  const noImager = wantsImages(input.answers, input.goal) && !imager ? "\n\nNo image agent is available: draw any icons and illustrations as inline SVG or CSS." : "";
  steps.push({
    role: "build",
    agentId: coder.id,
    model: model(coder, "build"),
    title: "Build it",
    brief: `Build the task below.${context.length ? ` Other agents on your team already worked on it and their output is in the Context section: ${context.join(", ")}.` : ""} When you finish, tell the user exactly how to open and view the result.${noImager}\n\n${input.brief}`,
    afterIndexes: deps,
    shareWorktreeOfIndex: imgIdx,
    optional: false,
    why: `${name(coder)} writes the code: it edits files with its own tools${coder.auth === "authenticated" ? " under your account sign-in" : ""}.`,
  });

  const reviewer = editors.find((a) => a.id !== coder.id) ?? local;
  if (reviewer) {
    steps.push({
      role: "review",
      agentId: reviewer.id,
      model: model(reviewer, "review"),
      title: "Review",
      brief: `Review the diff in the Context against the task below. List problems by severity with file and line, then say whether it is ready to use. Do not change any files.\n\n${input.brief}`,
      afterIndexes: [buildIdx],
      shareWorktreeOfIndex: null,
      optional: false,
      why:
        reviewer.kind === "local-runtime"
          ? `${name(reviewer)} reviews the diff locally.`
          : `${name(reviewer)} gives a second opinion from a different model vendor, read-only.`,
    });
  }
  return { steps, notes };
}
