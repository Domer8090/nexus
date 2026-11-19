import type { Metadata } from "next";
import { AdvancedView } from "./advanced-view";

export const metadata: Metadata = { title: "Advanced" };

export default function Page() {
  return <AdvancedView />;
}
