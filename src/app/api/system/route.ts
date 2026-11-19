import os from "node:os";
import { connection } from "next/server";
import { nexusHome, tildify } from "@/runtime/paths";
import { run } from "@/runtime/proc";

export async function GET() {
  await connection();
  const git = await run("git", ["--version"], { timeoutMs: 5000 });
  return Response.json({
    os: `${os.type()} ${os.release()} (${process.arch})`,
    platform: process.platform,
    shell: process.env.SHELL ? process.env.SHELL.split("/").pop() : "unknown",
    node: process.version,
    git: git.code === 0 ? git.stdout.trim().replace("git version ", "") : null,
    dataDir: tildify(nexusHome()),
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1e9),
    bind: "127.0.0.1",
  });
}
