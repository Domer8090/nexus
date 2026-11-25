"use client";

import { useWorkspace } from "@/components/workspace-context";
import { HackathonView } from "./hackathon-view";
import { HomeView } from "./home-view";

/** Home is different in each mode. */
export function ModeHome() {
  const { settings } = useWorkspace();
  if (!settings) return <div className="min-h-[60vh]" aria-busy="true" />;
  if (settings.mode === "hackathon") return <HackathonView />;
  return <HomeView />;
}
