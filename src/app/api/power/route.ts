import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { joinBackup, powerState } from "@/runtime/power";
import { run } from "@/runtime/proc";

/** Power and network state while agents work. Read-only, except joining the backup Wi-Fi on request. */
export async function GET() {
  await connection();
  let lidSleepOff: boolean | null = null;
  if (process.platform === "darwin") {
    const r = await run("pmset", ["-g"], { timeoutMs: 5000 });
    const m = r.stdout.match(/SleepDisabled\s+(\d)/);
    lidSleepOff = m ? m[1] === "1" : false;
  }
  return Response.json({ ...powerState(), lidSleepOff });
}

const schema = z.object({ network: z.string().trim().min(1).max(64), confirm: z.literal(true) });

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Name the network and confirm.");
  return Response.json(await joinBackup(p.data.network));
}
