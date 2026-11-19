"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, usePref } from "@/lib/client";
import type { AgentStatus, Project } from "@/lib/types";

type Ctx = {
  projects: Project[];
  project: Project | null;
  setProjectId: (id: string | null) => void;
  reloadProjects: () => Promise<void>;
  agents: AgentStatus[];
  agentsLoading: boolean;
  agentsError: string | null;
  reloadAgents: (force?: boolean) => Promise<void>;
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
};

const C = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectIdPref] = usePref<string | null>("project", null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = usePref("contextPanel", true);

  const reloadProjects = useCallback(async () => {
    try {
      const r = await api<{ projects: Project[] }>("/api/projects");
      setProjects(r.projects);
    } catch {}
  }, []);

  const reloadAgents = useCallback(async (force = false) => {
    setAgentsLoading(true);
    try {
      const r = await api<{ agents: AgentStatus[] }>(`/api/agents${force ? "?force=1" : ""}`);
      setAgents(r.agents);
      setAgentsError(null);
    } catch (e) {
      setAgentsError((e as Error).message);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadProjects();
    reloadAgents();
  }, [reloadProjects, reloadAgents]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? projects[0] ?? null, [projects, projectId]);

  return (
    <C.Provider
      value={{ projects, project, setProjectId: setProjectIdPref, reloadProjects, agents, agentsLoading, agentsError, reloadAgents, contextOpen, setContextOpen }}
    >
      {children}
    </C.Provider>
  );
}

export function useWorkspace() {
  const v = useContext(C);
  if (!v) throw new Error("useWorkspace outside provider");
  return v;
}
