import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { THEME_BOOT_SCRIPT, ThemeSync } from "@/components/theme-sync";
import { WorkspaceProvider } from "@/components/workspace-context";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Nexus", template: "%s · Nexus" },
  description: "One local workspace for your coding agents, skills and MCP tools.",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* The shell reads the URL (active nav item), so it renders at request time behind this boundary. */}
        <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
          <WorkspaceProvider>
            <ThemeSync />
            <AppShell>{children}</AppShell>
          </WorkspaceProvider>
        </Suspense>
      </body>
    </html>
  );
}
