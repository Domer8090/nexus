// Builds Nexus's project map for a folder with Nexus's own code. Usage: node map.mjs <dir>
import path from "node:path";
import { createJiti } from "jiti";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") } });
const m = await jiti.import(path.join(ROOT, "src/runtime/project-map.ts"));
const r = await m.writeMap(process.argv[2]);
console.log(JSON.stringify({ files: r.files, bytes: r.bytes, truncated: r.truncated, error: r.error, instruction: m.MAP_INSTRUCTION }));
