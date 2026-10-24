import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRESTLE — The Life-Event Compiler",
  description:
    "Turning complex life events into clear, dependency-aware workflows.",
};

export default function RootLayout(
  { children }: Readonly<{ children: React.ReactNode }>,
) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
