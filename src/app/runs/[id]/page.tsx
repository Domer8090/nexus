import type { Metadata } from "next";
import { RunDetail } from "./run-detail";

export const metadata: Metadata = { title: "Run" };

/** A run page depends on the URL's run id and live local state, so navigating to it may block briefly. */
export const instant = false;

export default function Page() {
  return <RunDetail />;
}
