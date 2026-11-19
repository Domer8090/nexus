import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-only guard. Nexus controls processes on this machine, so:
 * - only loopback Host headers are accepted (blocks DNS-rebinding),
 * - state-changing requests must come from the Nexus page itself (blocks cross-site requests).
 * The server also binds to 127.0.0.1 (see package.json scripts).
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return new NextResponse("Nexus only accepts local requests.", { status: 403 });
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    const sameOrigin = origin ? new URL(origin).host === host : site === "same-origin";
    if (!sameOrigin) return NextResponse.json({ error: { code: "cross_origin", message: "Request blocked: it did not come from the Nexus page." } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
