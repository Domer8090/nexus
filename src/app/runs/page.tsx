import type { Metadata } from "next";
import { RunsView } from "./runs-view";

export const metadata: Metadata = { title: "Runs" };

export default function Page() {
  return <RunsView />;
}
