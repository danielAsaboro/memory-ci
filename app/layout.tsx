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
  title: { default: "Memory CI", template: "%s · Memory CI" },
  description: "Pull requests, evaluation, promotion, and rollback for production agent memory.",
  metadataBase: new URL("https://memory-ci.example.com"),
  openGraph: {
    title: "Memory CI — ship agent memory like code",
    description: "Pull requests, behavioral evaluation, atomic promotion, lineage, and rollback for production agent memory.",
    images: [{ url: "/memory-ci-social.png", width: 1731, height: 909, alt: "A governed agent-memory release path with a quarantined branch" }],
  },
  twitter: { card: "summary_large_image", images: ["/memory-ci-social.png"] },
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
