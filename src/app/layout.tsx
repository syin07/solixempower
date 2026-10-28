import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Candidate Benchmark",
  description: "Benchmark a drug candidate's measured potency, clinical landscape, and cited AI evidence report.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-100">
        <main className="flex-1">{children}</main>
        <footer className="border-t border-zinc-200 bg-white px-4 py-3 text-center text-sm text-zinc-600">
          Potency in an assay does not establish clinical efficacy or safety. A repurposing hypothesis here is a traceable
          gap in public evidence, not a prediction of efficacy.
        </footer>
      </body>
    </html>
  );
}
