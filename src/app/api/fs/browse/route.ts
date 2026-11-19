import { connection } from "next/server";
import { bad } from "@/lib/api";
import { browse } from "@/runtime/workspace";

export async function GET(req: Request) {
  await connection();
  const r = browse(new URL(req.url).searchParams.get("path") ?? "");
  if (!r.ok) return bad(r.error);
  return Response.json(r);
}
