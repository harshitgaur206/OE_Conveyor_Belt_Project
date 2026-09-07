import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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

// Runs before hydration so the saved theme is applied before first paint —
// without this, the page would flash the default "brown" theme for a beat
// before JS picks up a saved "blue" preference from localStorage.
const themeInitScript = `
(function () {
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "blue") document.documentElement.setAttribute("data-theme", "blue");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text">
        {/* beforeInteractive is Next.js's supported mechanism for a script
            that must run before hydration — a plain <script> tag in the
            App Router isn't guaranteed to execute the same way. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
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
