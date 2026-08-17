import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "./components/app-shell";
import { DataProvider } from "./lib/query-client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Stash", template: "%s · Stash" },
  description: "Governed agent-memory releases for production AI systems.",
  metadataBase: new URL("https://trystash.xyz"),
  openGraph: {
    title: "Stash — governed agent-memory releases",
    description: "Propose, evaluate, promote, inspect, and roll back agent memory with production controls.",
    images: [{ url: "/stash-social.png", width: 1731, height: 909, alt: "Stash governs the release path for production agent memory" }],
  },
  twitter: { card: "summary_large_image", images: ["/stash-social.png"] },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DataProvider><AppShell>{children}</AppShell></DataProvider>
      </body>
    </html>
  );
}
