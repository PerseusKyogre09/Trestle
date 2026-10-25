import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRESTLE — A clear next step",
  description:
    "A steady hand for life’s paperwork, official guidance, and decisions that need you.",
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
