import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";


export const metadata: Metadata = {
  title: "Buffer",
  description: "Automatically hedges your BTC and ETH around CPI, jobs and Fed days, using SoSoValue data and SoDEX perps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
