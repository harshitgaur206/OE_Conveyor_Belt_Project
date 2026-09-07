import type { Metadata } from "next";
import { cookies } from "next/headers";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme read server-side from a cookie (set by Header's toggle) so the
  // correct data-theme attribute is already in the HTML the server sends —
  // no blocking init script needed, and nothing for the client to "catch
  // up" on after hydration, which is what caused both the script-tag
  // console error and the hydration mismatch from the previous
  // script+localStorage approach.
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value === "blue" ? "blue" : undefined;

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        <div className="app-backdrop" aria-hidden="true" />
        {children}
        <Toaster
          position="top-right"
          richColors
          toastOptions={{
            style: {
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              backdropFilter: "blur(8px)",
            },
          }}
        />
      </body>
    </html>
  );
}
