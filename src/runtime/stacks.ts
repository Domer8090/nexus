import { kvGet, kvSet } from "./db";
import type { SkillStack, StackStage } from "@/lib/types";

const key = (projectId: string) => `stack:${projectId}`;

export function getStack(projectId: string): SkillStack {
  return kvGet<SkillStack>(key(projectId)) ?? { projectId, instructions: "", items: [], updatedAt: new Date(0).toISOString() };
}

export function saveStack(stack: SkillStack) {
  const clean: SkillStack = {
    projectId: stack.projectId,
    instructions: stack.instructions.slice(0, 4000),
    items: stack.items.filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(0, 60),
    updatedAt: new Date().toISOString(),
  };
  kvSet(key(stack.projectId), clean);
  return clean;
}

/** Portable manifest a teammate can recreate with the Skills CLI. */
export function exportManifest(stack: SkillStack, projectName: string) {
  const byStage: Record<string, string[]> = {};
  for (const it of stack.items) (byStage[it.stage] ??= []).push(it.id);
  return {
    format: "nexus-skill-stack/v1",
    project: projectName,
    exportedAt: new Date().toISOString(),
    instructions: stack.instructions,
    stages: byStage as Record<StackStage, string[]>,
    install: stack.items.map((it) => {
      const at = it.id.lastIndexOf("@");
      return `npx skills add ${it.id.slice(0, at)} --skill ${it.id.slice(at + 1)}`;
    }),
  };
}
