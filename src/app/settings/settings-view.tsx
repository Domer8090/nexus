"use client";

import { useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Dialog, Field, PageHeader, Segmented, Spinner, Toast, cx, inputClass } from "@/components/ui";
import { useTheme, type ThemePref } from "@/components/theme-sync";
import { useWorkspace } from "@/components/workspace-context";
import { api, useApi } from "@/lib/client";
import { CONCISE_LABELS, PREFERENCE_LABELS, type ConciseMode, type PermissionSet, type Preference, type Settings } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4 sm:p-5">
      <h3 className="eyebrow mb-4">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

type Power = { platform: string; awake: boolean; online: boolean; waitingForNetwork: number; lastJoin: { at: string; network: string; ok: boolean; message: string } | null; lidSleepOff: boolean | null };

/** Keeps long runs going: caffeinate while agents work, and a backup Wi-Fi such as an iPhone hotspot. */
function KeepRunning({ st, patch, notify }: { st: Settings; patch: (p: Partial<Settings>) => Promise<void>; notify: (m: string) => void }) {
  const pw = useApi<Power>("/api/power", { interval: 10_000 });
  const [net, setNet] = useState(st.backupNetwork ?? "");
  const [joining, setJoining] = useState(false);
  const d = pw.data;
  if (d && d.platform !== "darwin") return <p className="text-[13px] text-ink-2">Keep awake and backup Wi-Fi work on macOS only.</p>;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <label className="flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={st.keepAwake} onChange={(e) => patch({ keepAwake: e.target.checked })} />
        <span>
          <span className="font-medium text-ink">Keep this Mac awake while agents work</span>
          <span className="block text-[12px] text-ink-3">Holds macOS&apos;s own caffeinate while any step runs or waits, and lets go when the run ends. {d?.awake ? "Holding it now." : ""}</span>
        </span>
      </label>
      <p className="text-[12.5px] text-ink-2">
        {d?.lidSleepOff
          ? "Closing the lid won't sleep this Mac: macOS sleep is turned off (pmset disablesleep). Keep it ventilated, not in a bag."
          : "Closing the lid still sleeps this Mac, which stops the agents. To keep going with the lid closed, plug in an external display, or turn macOS sleep off yourself in Terminal with sudo pmset -a disablesleep 1 (undo with 0)."}
      </p>
      <Field label="Backup Wi-Fi when the connection drops" htmlFor="bnet" hint="For example your iPhone hotspot's name. Join it once by hand so macOS keeps its password in your keychain. Nexus never stores the password. Steps that failed because the network dropped run again once it's back.">
        <div className="flex flex-wrap gap-2">
          <input id="bnet" value={net} onChange={(e) => setNet(e.target.value)} onBlur={() => net.trim() !== (st.backupNetwork ?? "") && patch({ backupNetwork: net.trim() || null })} placeholder="My iPhone" className={cx(inputClass, "max-w-xs flex-1")} />
          <Button
            disabled={!net.trim() || joining}
            onClick={async () => {
              setJoining(true);
              try {
                const r = await api<{ ok: boolean; message: string }>("/api/power", { body: { network: net.trim(), confirm: true } });
                notify(r.message);
                pw.reload();
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setJoining(false);
              }
            }}
          >
            {joining ? <Spinner /> : null} Join now
          </Button>
        </div>
      </Field>
      {d && (d.waitingForNetwork > 0 || !d.online || d.lastJoin) && (
        <p className="text-[12.5px] text-ink-2" aria-live="polite">
          {!d.online ? "Offline right now. " : ""}
          {d.waitingForNetwork ? `${d.waitingForNetwork} step${d.waitingForNetwork === 1 ? "" : "s"} waiting for the network. ` : ""}
          {d.lastJoin ? `Last switch to ${d.lastJoin.network}: ${d.lastJoin.ok ? "joined" : d.lastJoin.message}.` : ""}
        </p>
      )}
    </div>
  );
}

export function SettingsView() {
  const s = useApi<{ settings: Settings }>("/api/settings");
  const sys = useApi<{ os: string; shell: string; node: string; git: string | null; dataDir: string; cpus: number; memoryGb: number; bind: string }>("/api/system");
  const audit = useApi<{ entries: { id: number; at: string; action: string; detail: string }[] }>("/api/audit");
  const { agents } = useWorkspace();
  const [theme, setTheme] = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [resetText, setResetText] = useState("");
  const ollama = agents.find((a) => a.id === "ollama");
  const codexModels = agents.find((a) => a.id === "codex")?.modelInfo ?? [];

  const patch = async (p: Partial<Settings>) => {
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PATCH", body: p });
      s.setData(r);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const st = s.data?.settings;
  const perm = (k: keyof PermissionSet, v: boolean) => st && patch({ defaultPermissions: { ...st.defaultPermissions, [k]: v } });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Settings" pixel="Settings" heading="Settings on this computer" sub="Kept in SQLite in ~/.nexus. Nexus stores no API keys or sign-in tokens." />
      {!st ? (
        <Spinner />
      ) : (
        <>
          <Section title="Runtime">
            <Field label={`Parallel sessions: ${st.concurrency}`} htmlFor="conc" hint="Extra sessions wait in a queue. Each agent session uses CPU and memory on this machine.">
              <input id="conc" type="range" min={1} max={8} value={st.concurrency} onChange={(e) => patch({ concurrency: Number(e.target.value) })} className="accent-[var(--accent)]" />
            </Field>
            <Field label="Local model for brief refinement and reviews" htmlFor="olm" hint={ollama?.models.length ? "Runs on Ollama on this machine." : "Start Ollama and pull a model to use this."}>
              <select id="olm" value={st.ollamaModel ?? ""} onChange={(e) => patch({ ollamaModel: e.target.value || null })} className={inputClass} disabled={!ollama?.models.length}>
                <option value="">First available model</option>
                {ollama?.models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Default Claude Code model" htmlFor="ccm" hint="Aliases resolve to the latest model your plan allows.">
              <select id="ccm" value={st.claudeModel ?? ""} onChange={(e) => patch({ claudeModel: e.target.value || null })} className={inputClass}>
                <option value="">Picked for each job (Opus builds, Sonnet the rest)</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </Field>
            <Field label="Default Codex model" htmlFor="cxm" hint={codexModels.length ? "From Codex's own model list for your ChatGPT account." : "Codex hasn't listed its models yet. Run any Codex session once."}>
              <select id="cxm" value={st.codexModel ?? ""} onChange={(e) => patch({ codexModel: e.target.value || null })} className={inputClass} disabled={!codexModels.length}>
                <option value="">Picked for each job (first in Codex&apos;s list)</option>
                {codexModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}: {m.description}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-2.5 text-[13px]">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={st.projectMap} onChange={(e) => patch({ projectMap: e.target.checked })} />
              <span>
                <span className="font-medium text-ink">Project map for agents</span>
                <span className="block text-[12px] text-ink-3">Before each session Nexus writes NEXUS_MAP.md (every file, its size and what it defines) into the session&apos;s worktree and tells the agent to read it first instead of exploring folders. Kept out of git, so it never appears in a diff.</span>
              </span>
            </label>
            <KeepRunning st={st} patch={patch} notify={setToast} />
          </Section>

          <Section title="Default permissions for new sessions">
            {(
              [
                ["editFiles", "Edit project files"],
                ["isolate", "Isolate each session in a git worktree"],
                ["runShell", "Run shell commands"],
                ["network", "Web access (fetch and search tools)"],
              ] as [keyof PermissionSet, string][]
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-3 text-[13.5px]">
                <input type="checkbox" checked={st.defaultPermissions[k]} onChange={(e) => perm(k, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                {label}
              </label>
            ))}
            <p className="text-[12px] text-ink-3">Always blocked: work outside the project folder, push, deploy, rewriting git history. Read-only planners and reviewers never edit.</p>
          </Section>

          <Section title="Preferences">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Output style</span>
              <Segmented<ConciseMode> size="sm" label="Output style" value={st.defaultConcise} onChange={(v) => patch({ defaultConcise: v })} options={(Object.keys(CONCISE_LABELS) as ConciseMode[]).map((c) => ({ value: c, label: CONCISE_LABELS[c] }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Recommend agents for</span>
              <Segmented<Preference> size="sm" label="Preference" value={st.defaultPreference} onChange={(v) => patch({ defaultPreference: v })} options={(Object.keys(PREFERENCE_LABELS) as Preference[]).map((p) => ({ value: p, label: PREFERENCE_LABELS[p] }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-2">Theme (this browser)</span>
              <Segmented<ThemePref>
                size="sm"
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "Match system" },
                ]}
              />
            </div>
          </Section>
        </>
      )}

      <Section title="This machine and security">
        {sys.data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-3">System</dt>
            <dd>{sys.data.os}</dd>
            <dt className="text-ink-3">Shell</dt>
            <dd>{sys.data.shell}</dd>
            <dt className="text-ink-3">Node.js</dt>
            <dd>{sys.data.node}</dd>
            <dt className="text-ink-3">Git</dt>
            <dd>{sys.data.git ?? "Not found"}</dd>
            <dt className="text-ink-3">Hardware</dt>
            <dd>
              {sys.data.cpus} cores, {sys.data.memoryGb} GB memory
            </dd>
            <dt className="text-ink-3">Nexus data</dt>
            <dd className="font-mono">{sys.data.dataDir}</dd>
          </dl>
        ) : (
          <Spinner />
        )}
        <ul className="flex flex-col gap-1.5 border-t border-line pt-3 text-[13px] text-ink-2" aria-label="Security">
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />Server bound to {sys.data?.bind ?? "127.0.0.1"}. Requests from other hosts or other websites are rejected.</li>
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />Agents run with their own sign-in. Nexus removes ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY and GOOGLE_API_KEY from their environment.</li>
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />Only allowlisted programs run, with argument arrays and no shell.</li>
          <li className="flex gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden />Logs, events and the audit trail redact keys, tokens and email addresses.</li>
        </ul>
      </Section>

      <Section title="Local data">
        <div className="flex flex-wrap gap-2">
          <a href="/api/data/export" className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 text-sm hover:bg-surface-2">
            <Download size={15} aria-hidden /> Export Nexus data
          </a>
          <Button variant="danger" onClick={() => setReset(true)}>
            <Trash2 size={15} aria-hidden /> Reset Nexus data
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-[13px] text-ink-2">Audit log ({audit.data?.entries.length ?? 0})</summary>
          <pre className="term mt-2 max-h-72 overflow-auto rounded border border-line p-2 text-[11px] whitespace-pre-wrap text-ink-2">
            {audit.data?.entries.map((e) => `${e.at.slice(0, 19).replace("T", " ")}  ${e.action.padEnd(18)} ${e.detail}`).join("\n") || "Empty."}
          </pre>
        </details>
      </Section>

      <Dialog
        open={reset}
        onClose={() => setReset(false)}
        title="Reset Nexus data?"
        footer={
          <>
            <Button onClick={() => setReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={resetText !== "RESET"}
              onClick={async () => {
                try {
                  await api("/api/data/reset", { body: { confirm: "RESET" } });
                  window.location.assign(window.location.origin);
                } catch (e) {
                  setToast((e as Error).message);
                  setReset(false);
                }
              }}
            >
              Delete Nexus data
            </Button>
          </>
        }
      >
        <p className="mb-2">This deletes the project list, runs, session logs, skill stacks, settings and the audit log from Nexus&apos;s database. It does not touch your project files, worktrees, installed skills or any agent&apos;s configuration. It can&apos;t be undone.</p>
        <label htmlFor="reset-confirm" className="mb-1 block text-[13px]">
          Type RESET to confirm
        </label>
        <input id="reset-confirm" value={resetText} onChange={(e) => setResetText(e.target.value)} className={inputClass} />
      </Dialog>
      <Toast message={toast} />
    </div>
  );
}
