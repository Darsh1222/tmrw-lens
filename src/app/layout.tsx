import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tomorrow Lens",
  description: "Photograph your week and get a verified plan that rebuilds when you miss something.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
