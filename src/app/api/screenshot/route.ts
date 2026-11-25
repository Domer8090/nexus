import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { newId } from "@/runtime/ids";
import { nexusHome } from "@/runtime/paths";
import { run } from "@/runtime/proc";

let taking = false;

/** macOS's own area screenshot. Nothing is captured until the person drags an area, and Escape cancels. */
export async function POST(req: Request) {
  const p = z.object({ confirm: z.literal(true) }).safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  if (process.platform !== "darwin") return bad("Screenshots work on macOS only. Paste an image instead.");
  if (taking) return bad("A screenshot is already open. Press Escape to cancel it.");
  taking = true;
  const file = path.join(nexusHome(), `${newId("shot")}.png`);
  try {
    const r = await run("screencapture", ["-i", "-x", "-t", "png", file], { timeoutMs: 120_000 });
    if (!fs.existsSync(file)) {
      if (/could not create|not permitted|denied/i.test(r.stderr)) return bad("macOS blocked the screenshot. Allow it in System Settings, Privacy & Security, Screen Recording, then reopen Nexus.");
      return Response.json({ image: null });
    }
    if (fs.statSync(file).size > 25 * 1024 * 1024) return bad("That screenshot is too big. Drag a smaller area.");
    audit("screenshot", "area picked by the user");
    return Response.json({ image: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` });
  } finally {
    taking = false;
    fs.rmSync(file, { force: true });
  }
}
