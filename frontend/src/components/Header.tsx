"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { ScanLine, Sun, Moon } from "lucide-react";
import type { HealthResponse } from "@/types/detection";

type ConnectionState = "checking" | "connected" | "disconnected";
type Theme = "brown" | "blue";

interface HeaderProps {
  connectionState: ConnectionState;
  health: HealthResponse | null;
}

const stateConfig: Record<
  ConnectionState,
  { label: string; dot: string; ring: string; text: string }
> = {
  checking: {
    label: "Connecting",
    dot: "bg-amber-400",
    ring: "shadow-[0_0_8px_2px_rgba(251,191,36,0.55)]",
    text: "text-amber-500",
  },
  connected: {
    label: "Online",
    dot: "bg-emerald-500",
    ring: "shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]",
    text: "text-emerald-600",
  },
  disconnected: {
    label: "Offline",
    dot: "bg-red-500",
    ring: "shadow-[0_0_8px_2px_rgba(239,68,68,0.55)]",
    text: "text-red-500",
  },
};

function useClock() {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  return time;
}

// Self-contained (not lifted to context): every other component reacts to
// the data-theme attribute purely through CSS variables, so only this
// toggle itself needs JS-side theme state.
//
// Theme lives in a cookie, not localStorage: layout.tsx (a Server
// Component) reads that same cookie to render the correct data-theme
// attribute directly in the server HTML, so there's no blocking init
// script and no post-hydration "catch up" — the value read here on mount
// always matches what the server already rendered.
function readThemeCookie(): Theme {
  if (typeof document === "undefined") return "brown";
  return document.cookie.split("; ").some((c) => c === "theme=blue") ? "blue" : "brown";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(readThemeCookie);

  const toggle = () => {
    setTheme((current) => {
      const next = current === "brown" ? "blue" : "brown";
      if (next === "blue") {
        document.documentElement.setAttribute("data-theme", "blue");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  return { theme, toggle };
}

export function Header({ connectionState, health }: HeaderProps) {
  const config = stateConfig[connectionState];
  const time = useClock();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/20">
            <ScanLine className="h-5 w-5 text-accent" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-text">Cement Bag Detection Hub</h1>
        </div>

        <div className="flex items-center gap-3">
          {time && (
            <span className="hidden font-mono text-xs tabular-nums text-text-faint sm:inline">
              {time}
            </span>
          )}

          <button
            onClick={toggle}
            title={theme === "brown" ? "Switch to blue theme" : "Switch to brown theme"}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-subtle text-text-muted transition-colors hover:border-border-strong hover:text-accent"
          >
            {theme === "brown" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          </button>

          <div className="flex items-center gap-2 rounded-full border border-border bg-bg-subtle py-1.5 pl-2.5 pr-3">
            <span className="relative flex h-2 w-2">
              <span
                className={clsx(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  config.dot,
                  connectionState !== "disconnected" && "pulse-ring"
                )}
              />
              <span className={clsx("relative inline-flex h-2 w-2 rounded-full", config.dot, config.ring)} />
            </span>
            <span className={clsx("font-mono text-xs font-medium tracking-wide", config.text)}>
              {config.label}
            </span>
            {health?.model_loaded === false && connectionState === "connected" && (
              <span className="text-[11px] text-amber-500">model not loaded</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
