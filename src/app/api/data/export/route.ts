import { connection } from "next/server";
import { getDb } from "@/runtime/db";

/** Exports Nexus's own metadata. Contains no credentials, because Nexus stores none. */
export async function GET() {
  await connection();
  const db = getDb();
  const dump = {
    format: "nexus-export/v1",
    exportedAt: new Date().toISOString(),
    projects: db.prepare("SELECT * FROM projects").all(),
    workflows: db.prepare("SELECT * FROM workflows").all(),
    sessions: (db.prepare("SELECT data FROM sessions").all() as { data: string }[]).map((r) => JSON.parse(r.data)),
    skillInstalls: db.prepare("SELECT * FROM skill_installs").all(),
    settings: db.prepare("SELECT * FROM kv").all(),
    audit: db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 1000").all(),
  };
  return new Response(JSON.stringify(dump, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="nexus-export.json"' } });
}
