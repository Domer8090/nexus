import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { pickAgent, saveImages } from "@/runtime/ask";
import { createWorkflow } from "@/runtime/sessions";
import { getSettings } from "@/runtime/settings";
import { getProject } from "@/runtime/workspace";

const schema = z.object({
  projectId: z.string().min(1),
  request: z.string().trim().min(1, "Say what you want the agents to add.").max(8000),
  images: z.array(z.string().max(12_000_000)).max(6).default([]),
});

/** One request from the Advanced workspace: the local model picks the agent, Nexus starts it. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const project = getProject(p.data.projectId);
  if (!project) return bad("Pick a project first.");
  let files: string[];
  try {
    files = saveImages(p.data.images);
  } catch (e) {
    return bad((e as Error).message);
  }
  const st = getSettings();
  let pick;
  try {
    pick = await pickAgent(p.data.request, files.length > 0, st);
  } catch (e) {
    return bad((e as Error).message);
  }
  const brief = [p.data.request, files.length ? `Screenshots attached (${files.length}). Look at them before you change anything:\n${files.map((f) => `- ${f}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  const { sessions } = await createWorkflow({
    projectId: project.id,
    preset: "solo",
    goal: p.data.request,
    brief,
    tasks: [{ role: pick.role, agentId: pick.agentId, title: p.data.request.split("\n")[0].slice(0, 60), brief, model: pick.model }],
    skills: [],
    concise: st.defaultConcise,
    permissions: st.defaultPermissions,
    attachments: files,
  });
  audit("advanced.ask", `${sessions[0].id} agent=${pick.agentId} by=${pick.by} images=${files.length}`);
  return Response.json({ session: sessions[0], pick });
}
