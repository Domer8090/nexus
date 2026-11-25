/* eslint-disable @typescript-eslint/no-require-imports */
// Starts the Nexus server for the Mac app and stops with it.
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

process.chdir(path.join(__dirname, "server"));
process.env.NODE_ENV = "production";
process.env.HOSTNAME = "127.0.0.1";

// The app holds our stdin open. If it quits or crashes, stdin ends and so do we (and the agents).
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => process.exit(0));

const free = (port) =>
  new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(0));
    s.listen(port, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });

(async () => {
  // A steady port keeps the window's own preferences between launches.
  const port = (await free(43117)) || (await free(0));
  process.env.PORT = String(port);
  require("./server/server.js");
  const tell = (tries) =>
    http
      .get({ host: "127.0.0.1", port, path: "/api/settings" }, (r) => {
        r.resume();
        if (r.statusCode === 200) console.log(`NEXUS_READY ${port}`);
        else retry(tries);
      })
      .on("error", () => retry(tries));
  const retry = (n) => (n > 0 ? setTimeout(() => tell(n - 1), 200) : (console.error("The Nexus server did not start."), process.exit(1)));
  tell(150);
})();
