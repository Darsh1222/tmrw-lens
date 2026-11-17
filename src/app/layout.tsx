import type { Metadata, Viewport } from "next";
import { forumCaps, forumDisplay, forumSans } from "./fonts";
import "./globals.css";
import "./_workspace/workspace.css";

export const metadata: Metadata = {
  title: "Tomorrow Lens",
  description:
    "Verify course deadlines, plan study time around your commitments, and recover unfinished work when plans change.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f1e7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1b33" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${forumSans.variable} ${forumDisplay.variable} ${forumCaps.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
