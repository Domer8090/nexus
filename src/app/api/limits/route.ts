import { connection } from "next/server";
import { agentLimits, describe } from "@/runtime/limits";

/** Usage limits each account agent last reported. Empty when nothing has been reported. */
export async function GET() {
  await connection();
  return Response.json({ limits: agentLimits(true).map((l) => ({ ...l, text: describe(l) })) });
}
