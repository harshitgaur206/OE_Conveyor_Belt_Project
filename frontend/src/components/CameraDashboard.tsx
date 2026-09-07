"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { getCameraStats } from "@/lib/api";
import type { CameraSummary, WebcamStats } from "@/types/detection";

const STATS_POLL_INTERVAL_MS = 1_000;

function CameraStatChip({ camera }: { camera: CameraSummary }) {
  const [stats, setStats] = useState<WebcamStats | null>(null);
  // Tracks whether the count just went up (vs. an unrelated stats refresh,
  // e.g. confidence changing) so the pop animation only fires on an actual
  // new bag, not every 1s poll tick.
  const prevCount = useRef<number | null>(null);
  const [justIncremented, setJustIncremented] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await getCameraStats(camera.id);
        if (cancelled) return;
        if (prevCount.current !== null && result.bag_count > prevCount.current) {
          setJustIncremented(true);
        }
        prevCount.current = result.bag_count;
        setStats(result);
      } catch {
        // transient — chip just keeps showing the last known count
      }
    }

    poll();
    const interval = setInterval(poll, STATS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [camera.id]);

  const isLive = stats?.active ?? false;

  return (
    <div
      className={`flex shrink-0 items-center gap-3.5 rounded-xl border px-4 py-3 transition-colors duration-300 ${
        justIncremented ? "border-accent/60 bg-accent/[0.07]" : "border-border bg-bg-elevated/60"
      }`}
      onAnimationEnd={() => setJustIncremented(false)}
    >
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-inset ring-accent/20">
        <Radio className="h-4 w-4 text-accent" />
        {isLive && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-red-500" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-text-faint">
          {camera.name}
        </p>
        <p className="flex items-baseline gap-1.5 leading-none">
          <span
            key={stats?.bag_count ?? "pending"}
            className={`font-mono text-3xl font-extrabold tabular-nums text-accent ${
              justIncremented ? "count-pop" : ""
            }`}
          >
            {stats?.bag_count ?? "--"}
          </span>
          <span className="text-[11px] font-medium text-text-faint">bags</span>
          {stats && !stats.active && (
            <span className="text-[10px] font-medium text-amber-500">· idle</span>
          )}
        </p>
      </div>
    </div>
  );
}

interface CameraDashboardProps {
  cameras: CameraSummary[];
}

// A compact per-camera summary strip: at-a-glance bag counts across every
// active RTSP camera, independent of which tile (if any) is expanded in
// the grid below it.
export function CameraDashboard({ cameras }: CameraDashboardProps) {
  if (cameras.length === 0) return null;

  return (
    <div className="flex w-full gap-2 overflow-x-auto pb-1">
      {cameras.map((camera) => (
        <CameraStatChip key={camera.id} camera={camera} />
      ))}
    </div>
  );
}
