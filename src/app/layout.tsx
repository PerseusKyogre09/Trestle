import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TRESTLE — One problem. One clear next step.",
    template: "%s — TRESTLE",
  },
  description:
    "TRESTLE helps you navigate complicated real-life situations: understand the problem, make a plan, research information, and get things done.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
