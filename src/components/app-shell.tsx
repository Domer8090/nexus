"use client";

import { Picker } from "./picker";
import { FolderPicker } from "./folder-picker";
import { tidyPath } from "@/lib/format";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Blocks, Bot, CircleHelp, FolderGit2, LayoutDashboard, Menu, PanelLeft, PanelRight, Play, Plug, Plus, Settings, Sparkles, SquareTerminal, X } from "lucide-react";
import { NexusMark } from "./logo";
import { ContextPanel } from "./context-panel";
import { Button, Toast, cx } from "./ui";
import { useWorkspace } from "./workspace-context";
import { LiveChip } from "./build-live";
import { Onboarding } from "./onboarding";
import { QuestionDock } from "./question-dock";
import { Tour } from "./tour";
import { MODE_INFO, UI_MODES, allowedIn, modeHome, type UiMode } from "@/lib/modes";
import { useApi } from "@/lib/client";
import type { Session } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/playground", label: "Playground", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/skills", label: "Skills", icon: Blocks },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Home"],
  [/^\/playground/, "Playground"],
  [/^\/agents/, "Agent fleet"],
  [/^\/skills/, "Skills"],
  [/^\/projects/, "Projects"],
  [/^\/runs\/.+/, "Run"],
  [/^\/runs/, "Runs"],
  [/^\/integrations/, "Integrations"],
  [/^\/settings/, "Settings"],
  [/^\/advanced/, "Advanced"],
];

const ADVANCED = { href: "/advanced", label: "Advanced", icon: SquareTerminal };

const pick = (href: string, label?: string) => {
  const n = NAV.find((x) => x.href === href)!;
  return label ? { ...n, label } : n;
};
const NAVS: Record<UiMode, typeof NAV> = {
  beginner: NAV,
  advanced: [ADVANCED, pick("/agents"), pick("/skills"), pick("/projects"), pick("/integrations"), pick("/settings")],
  hackathon: [pick("/", "Hackathon"), pick("/runs"), pick("/skills"), pick("/agents"), pick("/settings")],
};

function ProjectSwitcher() {
  const { projects, project, setProjectId, reloadProjects } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const dialog = (
    <FolderPicker
      open={adding}
      onClose={() => setAdding(false)}
      onPicked={async (p) => {
        setAdding(false);
        await reloadProjects();
        setProjectId(p.id);
      }}
    />
  );
  if (!projects.length)
    return (
      <>
        <button type="button" onClick={() => setAdding(true)} className="flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong px-2.5 text-[13px] text-ink-2 hover:text-ink">
          <Plus size={14} aria-hidden /> Add a project
        </button>
        {dialog}
      </>
    );
  return (
    <div>
      <p className="mb-1 px-1 font-mono text-[11px] text-ink-3">Workspace</p>
      <Picker
        label="Workspace"
        size="sm"
        className="font-mono"
        value={project?.id ?? ""}
        onChange={setProjectId}
        options={projects.map((p) => ({ value: p.id, label: p.name, hint: tidyPath(p.path) }))}
        action={{ label: "Add a project", icon: <Plus size={15} aria-hidden />, onClick: () => setAdding(true) }}
      />
      {dialog}
    </div>
  );
}

function NavList({ onNavigate, running, mode }: { onNavigate?: () => void; running: number; mode: UiMode }) {
  const pathname = usePathname();
  const items = NAVS[mode];
  return (
    <ul className="flex flex-col gap-px">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx("relative flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 font-mono text-[12.5px] transition-colors", active ? "bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-ink" : "text-ink-3 hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)] hover:text-ink")}
            >
              <Icon size={15} strokeWidth={1.6} aria-hidden />
              {label}
              {href === "/runs" && running > 0 && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-ok">
                  <span className="live-dot inline-block size-1.5 rounded-full bg-current" aria-hidden />
                  {running}
                  <span className="sr-only">running</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RuntimeStatus() {
  const { agents, agentsLoading } = useWorkspace();
  const ready = agents.filter((a) => a.integration === "supported" && a.install === "installed" && (a.auth === "authenticated" || a.auth === "not-required"));
  return (
    <Link href="/agents" className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 font-mono text-[11.5px] text-ink-3 hover:text-ink-2">
      <span className={cx("size-1.5 shrink-0 rounded-full", ready.length ? "bg-ok shadow-[0_0_8px_var(--ok)]" : "bg-warn")} aria-hidden />
      {agentsLoading && !agents.length ? "Detecting agents…" : `${ready.length} agent${ready.length === 1 ? "" : "s"} ready, local runtime on 127.0.0.1`}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavHidden(window.localStorage.getItem("nexus.nav.hidden") === "1");
    } catch {}
  }, []);
  const toggleNav = () => {
    setNavHidden((h) => {
      try {
        window.localStorage.setItem("nexus.nav.hidden", h ? "0" : "1");
      } catch {}
      return !h;
    });
  };
  const { contextOpen, setContextOpen, settings, patchSettings } = useWorkspace();
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Nexus";
  const { data } = useApi<{ running: number; sessions: Session[] }>("/api/sessions", { interval: 4000 });
  const running = data?.sessions.filter((s) => s.status === "running" || s.status === "starting").length ?? 0;
  const runningNow = data?.sessions.filter((s) => s.status === "running") ?? [];
  const router = useRouter();
  const [tour, setTour] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mode = settings?.mode ?? "beginner";
  const allowed = !!settings && allowedIn(mode, pathname);
  // Also moves the person on when a hackathon ends by itself.
  useEffect(() => {
    if (settings && !allowed) router.replace(modeHome(mode));
  }, [settings, allowed, mode, router]);
  const changeMode = async (m: UiMode) => {
    try {
      await patchSettings({ mode: m });
      router.push(modeHome(m));
    } catch (e) {
      setToast((e as Error).message);
      window.setTimeout(() => setToast(null), 4000);
    }
  };
  const closeTour = useCallback(() => {
    setTour(false);
    if (settings && !settings.toured.includes(settings.mode)) void patchSettings({ toured: [...settings.toured, settings.mode] }).catch(() => {});
  }, [settings, patchSettings]);
  const startTour = () => {
    if (pathname !== modeHome(mode)) router.push(modeHome(mode));
    setTour(true);
  };
  // First visit to a mode's home shows its tour once.
  const firstTour = !!settings?.onboarded && !settings.toured.includes(settings.mode) && pathname === modeHome(mode) && (settings.mode !== "hackathon" || (!!settings.hackathon && !settings.hackathon.endedAt));

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const side = (onNavigate?: () => void) => (
    <>
      <Link href={modeHome(mode)} onClick={onNavigate} className="mb-5 flex items-center gap-2.5 px-1.5">
        <NexusMark className="size-6" />
        <span className="font-mono text-[15px] font-medium tracking-[0.04em]">NEXUS</span>
      </Link>
      {settings && mode !== "hackathon" && (
        <div className="mb-4" data-tour="workspace">
          <ProjectSwitcher />
        </div>
      )}
      <nav aria-label="Main" data-tour="nav">
        {settings && <NavList onNavigate={onNavigate} running={running} mode={mode} />}
      </nav>
      <div className="mt-auto pt-4">
        <RuntimeStatus />
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-[70] rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      {!navHidden && <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">{side()}</aside>}

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-[rgb(5_7_10/0.55)]" onClick={() => setDrawer(false)} />
          <div className="glass absolute inset-y-2 left-2 flex w-72 flex-col rounded-[var(--radius-dock)] p-3" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="sm" aria-label="Close menu" onClick={() => setDrawer(false)}>
                <X size={18} />
              </Button>
            </div>
            {side(() => setDrawer(false))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-[52px] items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--canvas)_70%,transparent)] px-3 backdrop-blur-xl sm:px-4">
          <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Menu size={18} />
          </Button>
          <span className="hidden lg:inline-flex">
            <Button variant="ghost" size="sm" aria-pressed={!navHidden} aria-label={navHidden ? "Show the sidebar" : "Hide the sidebar"} title={navHidden ? "Show the sidebar" : "Hide the sidebar"} onClick={toggleNav}>
              <PanelLeft size={17} />
            </Button>
          </span>
          <h1 className="truncate font-mono text-[13px] font-medium tracking-[0.02em]">{title}</h1>
          <div className="ml-auto flex items-center gap-1.5">
            {runningNow[0] && <LiveChip key={runningNow[0].id} session={runningNow[0]} />}
            <div data-tour="mode" className="w-32">
              <Picker label="Mode" size="sm" value={settings ? mode : ""} placeholder="" onChange={(m) => changeMode(m as UiMode)} options={UI_MODES.map((m) => ({ value: m, label: MODE_INFO[m].label, hint: MODE_INFO[m].body }))} />
            </div>
            <span data-tour="help">
              <Button variant="ghost" size="sm" aria-label="Show the tour" title="Show the tour" onClick={startTour}>
                <CircleHelp size={17} />
              </Button>
            </span>
            {settings && mode === "beginner" && <Link
              href="/playground"
              onClick={() => {
                try {
                  window.sessionStorage.setItem("nexus.new", "1");
                } catch {}
                // Already on the Playground: the page doesn't remount, so tell it directly.
                window.dispatchEvent(new Event("nexus:new-task"));
              }}
              className="btn-step inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-accent bg-accent px-3 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-accent-ink hover:bg-accent-hover"
            >
              <Plus size={15} aria-hidden /> <span className="max-sm:sr-only">New task</span>
            </Link>}
            <span className={mode === "beginner" ? "hidden xl:inline-flex" : "hidden"}>
              <Button variant="ghost" size="sm" aria-pressed={contextOpen} aria-label={contextOpen ? "Hide context panel" : "Show context panel"} onClick={() => setContextOpen(!contextOpen)}>
                <PanelRight size={17} />
              </Button>
            </span>
          </div>
        </header>
        <div className="flex min-w-0 flex-1">
          <main id="main" className="min-w-0 flex-1 px-3 pt-5 pb-24 sm:px-4 lg:px-6">
            {allowed ? children : null}
          </main>
          {settings && mode === "beginner" && contextOpen && (
            <aside aria-label="Project context" className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-80 shrink-0 overflow-y-auto border-l border-line px-4 pt-5 pb-8 xl:block">
              <ContextPanel />
            </aside>
          )}
        </div>
      </div>
      {settings && !settings.onboarded && <Onboarding onDone={() => setTour(false)} />}
      {settings?.onboarded && (tour || firstTour) && <Tour key={mode} mode={mode} onClose={closeTour} />}
      {settings && pathname.startsWith("/advanced") && runningNow[0]?.workflowId && <QuestionDock key={runningNow[0].workflowId} id={runningNow[0].workflowId} kind="run" live floating />}
      <Toast message={toast} />
    </div>
  );
}
