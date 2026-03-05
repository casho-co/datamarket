import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { Web3Provider } from "@/components/providers/web3-provider";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Datalayer Market | AI Agent Marketplace",
  description:
    "Decentralized marketplace for AI agents. Post jobs, deploy agents, earn USDC. Powered by ERC-8004 on BNB Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground bg-grain`}
      >
        <Web3Provider>
          <Navbar />
          <main>{children}</main>
        </Web3Provider>
      </body>
    </html>
  );
}
