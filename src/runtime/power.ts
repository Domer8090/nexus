import { spawn, type ChildProcess } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { audit } from "./audit";
import { run, which } from "./proc";
import { getSettings } from "./settings";

/**
 * Keeps long runs alive on a laptop:
 *
 * - Awake: while any step is running or queued, Nexus holds `caffeinate -i -m -s -w <pid>` (the
 *   macOS tool behind apps like Amphetamine). It stops idle sleep and disk sleep, and system sleep on
 *   power. It ends by itself if Nexus exits. A closed lid still sleeps the Mac unless macOS sleep is
 *   disabled (`pmset disablesleep`), which only you can turn on, with your admin password.
 * - Network: while work is pending, Nexus checks every 10 seconds whether DNS answers. After two
 *   failed checks it asks macOS to join your backup Wi-Fi (for example your iPhone hotspot) with
 *   `networksetup -setairportnetwork`. The password comes from your keychain, never from Nexus;
 *   join it once by hand so macOS saves it.
 * - Steps that failed because the network dropped run again once it is back.
 *
 * macOS only. Elsewhere it reports itself unavailable and does nothing.
 */

export type PowerState = {
  platform: string;
  awake: boolean;
  online: boolean;
  lastJoin: { at: string; network: string; ok: boolean; message: string } | null;
  waitingForNetwork: number;
};

type G = { child: ChildProcess | null; timer: NodeJS.Timeout | null; online: boolean; misses: number; lastTry: number; state: PowerState; waiting: Set<string>; onBack: ((ids: string[]) => void) | null };
const g = globalThis as unknown as { __nexusPower?: G };
g.__nexusPower ??= {
  child: null,
  timer: null,
  online: true,
  misses: 0,
  lastTry: 0,
  waiting: new Set(),
  onBack: null,
  state: { platform: process.platform, awake: false, online: true, lastJoin: null, waitingForNetwork: 0 },
};
const p = g.__nexusPower;

const mac = process.platform === "darwin";

function hold(on: boolean) {
  if (on && !p.child) {
    const bin = mac ? which("caffeinate") : null;
    if (!bin) return;
    p.child = spawn(bin, ["-i", "-m", "-s", "-w", String(process.pid)], { stdio: "ignore", shell: false });
    p.child.on("exit", () => {
      p.child = null;
      p.state.awake = false;
    });
    p.state.awake = true;
    audit("power.awake", "on");
  } else if (!on && p.child) {
    p.child.kill();
    p.child = null;
    p.state.awake = false;
    audit("power.awake", "off");
  }
}

/** DNS answer from the configured resolver, without the system cache, within 3 seconds. */
async function online(): Promise<boolean> {
  const r = new Resolver({ timeout: 3000, tries: 1 });
  try {
    await r.resolve4("apple.com");
    return true;
  } catch {
    return false;
  }
}

async function wifiDevice(): Promise<string | null> {
  const r = await run("networksetup", ["-listallhardwareports"], { timeoutMs: 5000 });
  const m = r.stdout.match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/);
  return m ? m[1] : null;
}

export async function joinBackup(network: string): Promise<{ ok: boolean; message: string }> {
  if (!mac) return { ok: false, message: "Joining a network is supported on macOS only." };
  const dev = await wifiDevice();
  if (!dev) return { ok: false, message: "No Wi-Fi hardware found." };
  const r = await run("networksetup", ["-setairportnetwork", dev, network], { timeoutMs: 30_000 });
  const out = (r.stdout + r.stderr).trim();
  const ok = r.code === 0 && !/error|could not|failed/i.test(out);
  const message = ok ? `Asked macOS to join ${network}.` : out || `macOS could not join ${network}.`;
  p.state.lastJoin = { at: new Date().toISOString(), network, ok, message };
  audit("power.join", `${network} ${ok ? "ok" : "failed"}`);
  return { ok, message };
}

/** A step that failed because the network dropped; it runs again when the network is back. */
export function waitForNetwork(sessionId: string) {
  p.waiting.add(sessionId);
  p.state.waitingForNetwork = p.waiting.size;
}

async function tick(busy: () => boolean) {
  const s = getSettings();
  const work = busy() || p.waiting.size > 0;
  hold(mac && s.keepAwake && work);
  if (!work) {
    p.misses = 0;
    return;
  }
  const up = await online();
  p.state.online = up;
  if (up) {
    p.misses = 0;
    if (p.waiting.size && p.onBack) {
      const ids = [...p.waiting];
      p.waiting.clear();
      p.state.waitingForNetwork = 0;
      p.onBack(ids);
    }
    return;
  }
  p.misses++;
  if (p.misses >= 2 && s.backupNetwork && Date.now() - p.lastTry > 60_000) {
    p.lastTry = Date.now();
    await joinBackup(s.backupNetwork);
  }
}

/** Starts the 10-second watchdog once. `busy` says whether steps are running or queued. */
export function startPowerWatch(busy: () => boolean, onBack: (ids: string[]) => void) {
  p.onBack = onBack;
  if (p.timer) return;
  p.timer = setInterval(() => void tick(busy), 10_000);
  p.timer.unref?.();
  void tick(busy);
}

export function powerState(): PowerState {
  return { ...p.state };
}
