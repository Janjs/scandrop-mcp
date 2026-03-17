import type { Metadata } from "next";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: "Scandrop Spatial Workbench",
  description: "Inspect scans, derived spatial geometry, and query placement via MCP."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-[var(--font-space)]">
        <TooltipProvider delayDuration={100}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
