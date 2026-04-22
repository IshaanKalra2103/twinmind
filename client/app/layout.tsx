import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/sessionStore";

export const metadata: Metadata = {
  title: "TwinMind — Live Suggestions",
  description:
    "Live AI meeting copilot: transcript, real-time suggestions, and chat.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
