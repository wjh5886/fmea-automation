import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FMEA Automation",
  description: "Software FMEA 자동화 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50">
        <nav className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6 shrink-0">
          <Link href="/" className="text-lg font-bold tracking-tight">⚙ FMEA Auto</Link>
          <Link href="/projects" className="text-sm text-slate-300 hover:text-white transition-colors">프로젝트</Link>
          <Link href="/guide" className="text-sm text-slate-300 hover:text-white transition-colors">S/O/D 기준표</Link>
          <Link href="/pre-fmea" className="text-sm text-slate-300 hover:text-white transition-colors">사전 FMEA</Link>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
