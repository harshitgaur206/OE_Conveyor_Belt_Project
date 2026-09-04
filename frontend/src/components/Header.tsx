"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { ScanLine } from "lucide-react";
import type { HealthResponse } from "@/types/detection";

type ConnectionState = "checking" | "connected" | "disconnected";

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
    ring: "shadow-[0_0_8px_2px_rgba(251,191,36,0.6)]",
    text: "text-amber-300",
  },
  connected: {
    label: "Online",
    dot: "bg-emerald-400",
    ring: "shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]",
    text: "text-emerald-300",
  },
  disconnected: {
    label: "Offline",
    dot: "bg-red-500",
    ring: "shadow-[0_0_8px_2px_rgba(239,68,68,0.6)]",
    text: "text-red-300",
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

export function Header({ connectionState, health }: HeaderProps) {
  const config = stateConfig[connectionState];
  const time = useClock();

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-[#05070d]/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 ring-1 ring-white/10">
            <ScanLine className="h-5 w-5 text-emerald-300" />
            <div className="absolute inset-0 rounded-xl bg-emerald-400/10 blur-md" />
          </div>
          <div>
            <h1 className="text-shimmer text-lg font-bold tracking-tight">
              Cement Bag Detection Hub
            </h1>
            <p className="font-mono text-[11px] tracking-wide text-slate-500">
              vision-pipeline · yolo + bytetrack
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {time && (
            <span className="hidden font-mono text-xs tabular-nums text-slate-500 sm:inline">
              {time}
            </span>
          )}
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-2.5 pr-3">
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
              <span className="text-[11px] text-amber-400">model not loaded</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
