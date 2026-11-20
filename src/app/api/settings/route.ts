import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { getSettings, saveSettings } from "@/runtime/settings";
import { CONCISE_MODES, PREFERENCES } from "@/lib/types";

export async function GET() {
  await connection();
  return Response.json({ settings: getSettings() });
}

const schema = z
  .object({
    concurrency: z.number().int().min(1).max(8),
    defaultConcise: z.enum(CONCISE_MODES),
    defaultPreference: z.enum(PREFERENCES),
    defaultPermissions: z.object({ editFiles: z.boolean(), runShell: z.boolean(), network: z.boolean(), isolate: z.boolean() }),
    ollamaModel: z.string().max(80).nullable(),
    claudeModel: z.string().max(80).nullable(),
    codexModel: z.string().max(80).nullable(),
    projectMap: z.boolean(),
    leanContext: z.boolean(),
    keepAwake: z.boolean(),
    advancedMode: z.boolean(),
    backupNetwork: z
      .string()
      .trim()
      .max(64)
      .regex(/^[^\u0000-\u001f]*$/)
      .nullable()
      .transform((v) => v || null),
  })
  .partial();

export async function PATCH(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid settings.");
  const s = saveSettings(p.data);
  audit("settings.update", Object.keys(p.data).join(","));
  return Response.json({ settings: s });
}
