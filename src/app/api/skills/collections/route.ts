import { COLLECTIONS } from "@/runtime/skills/collections";

export function GET() {
  return Response.json({ collections: COLLECTIONS, verifiedOn: "2026-11-17" });
}
