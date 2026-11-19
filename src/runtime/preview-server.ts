import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { getSession } from "./sessions";
import { getProject } from "./workspace";

/**
 * Static preview server for what agents build. It runs on its own port (a different origin from
 * Nexus), so a previewed page's scripts can't call the Nexus API, while the page itself still
 * works normally (localStorage and so on). Loopback only; refuses other Host headers, dotfiles
 * (.git, .env) and paths outside the session's folder.
 */

const BASE_PORT = 4317;
const g = globalThis as unknown as { __nexusPreview?: { server: http.Server; port: number } | Promise<{ server: http.Server; port: number }> };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function rootFor(kind: string, id: string): string | null {
  if (kind === "s") {
    const s = getSession(id);
    return s && fs.existsSync(s.cwd) ? s.cwd : null;
  }
  if (kind === "p") return getProject(id)?.path ?? null;
  return null;
}

const ENTRIES = ["index.html", "public/index.html", "dist/index.html", "build/index.html", "out/index.html", "site/index.html", "docs/index.html"];

/** How a folder can be viewed: a static entry page, or the dev command it needs. */
export function viewInfo(dir: string): { entry: string | null; devCommand: string | null; framework: string | null } {
  let devCommand: string | null = null;
  let framework: string | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    framework = deps.next ? "Next.js" : deps.vite ? "Vite" : deps.astro ? "Astro" : deps["react-scripts"] ? "Create React App" : null;
    if (pkg.scripts?.dev) devCommand = "npm install && npm run dev";
    else if (pkg.scripts?.start) devCommand = "npm install && npm start";
  } catch {}
  // A bundler project's index.html needs its dev server, so don't offer it as a static page.
  const bundled = framework === "Vite" || framework === "Next.js" || framework === "Astro";
  const entry = bundled ? null : ENTRIES.find((e) => fs.existsSync(path.join(dir, e))) ?? null;
  return { entry, devCommand, framework };
}

/** Latest modification time of the files in a folder (skips dotfiles and node_modules), so the UI can reload a preview when files change. */
export function folderVersion(dir: string, limit = 800): number {
  let max = 0;
  let seen = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 4 || seen > limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) {
        seen++;
        try {
          max = Math.max(max, fs.statSync(p).mtimeMs);
        } catch {}
      }
    }
  };
  walk(dir, 0);
  return Math.round(max);
}

function send(res: http.ServerResponse, code: number, body: string) {
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function handler(port: number) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const host = req.headers.host ?? "";
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`).test(host)) return send(res, 403, "Forbidden host");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Read-only preview");
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      return send(res, 400, "Bad URL");
    }
    const [, kind, id, ...rest] = url.pathname.split("/");
    if (!kind || !id || !/^[a-z]+_[a-z0-9]+$/i.test(id)) return send(res, 404, "Not found");
    if (rest.length === 0) {
      res.writeHead(302, { location: `/${kind}/${id}/` });
      return res.end();
    }
    const root = rootFor(kind, id);
    if (!root) return send(res, 404, "This preview is no longer available.");
    let rel: string;
    try {
      rel = decodeURIComponent(rest.join("/"));
    } catch {
      return send(res, 400, "Bad path");
    }
    if (rel.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules")) return send(res, 403, "Hidden files are not served");
    const realRoot = fs.realpathSync(root);
    let file = path.resolve(realRoot, rel);
    if (file !== realRoot && !file.startsWith(realRoot + path.sep)) return send(res, 403, "Outside the project");
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      const real = fs.realpathSync(file);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return send(res, 403, "Outside the project");
      const st = fs.statSync(real);
      if (!st.isFile()) return send(res, 404, "Not found");
      if (st.size > 64 * 1024 * 1024) return send(res, 413, "File too large to preview");
      res.writeHead(200, {
        "content-type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream",
        "content-length": st.size,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(real).pipe(res);
    } catch {
      return send(res, 404, `Not found: ${rel || "index.html"}`);
    }
  };
}

function listen(port: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler(port));
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port }));
  });
}

/** Starts the preview server once per Nexus process and returns its port. */
export async function previewPort(): Promise<number> {
  const cur = g.__nexusPreview;
  if (cur) return (await cur).port;
  const p = (async () => {
    for (let port = BASE_PORT; port < BASE_PORT + 20; port++) {
      try {
        return await listen(port);
      } catch {}
    }
    throw new Error("No free port for the preview server.");
  })();
  g.__nexusPreview = p;
  try {
    const v = await p;
    g.__nexusPreview = v;
    return v.port;
  } catch (e) {
    g.__nexusPreview = undefined;
    throw e;
  }
}

export async function previewUrl(kind: "s" | "p", id: string, entry: string) {
  const port = await previewPort();
  return `http://127.0.0.1:${port}/${kind}/${id}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}
