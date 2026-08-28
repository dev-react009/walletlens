import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WalletLens — understand any wallet in plain English",
  description:
    "Paste an Ethereum address and get a human-readable breakdown of its activity. No blockchain expertise needed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
