import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
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
  title: "Cement Bag Detection Hub",
  description: "Prototype dashboard for the Cement Bag Detection System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#05070d] text-slate-100">
        <div className="app-backdrop" aria-hidden="true" />
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          toastOptions={{
            style: {
              background: "rgba(15, 23, 42, 0.9)",
              border: "1px solid rgba(51, 65, 85, 0.6)",
              backdropFilter: "blur(8px)",
            },
          }}
        />
      </body>
    </html>
  );
}
