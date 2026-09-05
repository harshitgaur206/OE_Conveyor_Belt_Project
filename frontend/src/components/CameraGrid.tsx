"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2, Square } from "lucide-react";
import { cameraStreamUrl, getCameraStats, setCameraConfidence } from "@/lib/api";
import { ConfidenceSlider } from "@/components/ConfidenceSlider";
import type { CameraSummary, WebcamStats } from "@/types/detection";

const STATS_POLL_INTERVAL_MS = 1_000;

const GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  4: "grid-cols-1 sm:grid-cols-2",
  6: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  9: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

interface CameraTileProps {
  camera: CameraSummary;
  large?: boolean;
  onStop: (id: string) => void;
  onToggleExpand: (id: string) => void;
  isExpanded: boolean;
}

function CameraTile({ camera, large, onStop, onToggleExpand, isExpanded }: CameraTileProps) {
  const [stats, setStats] = useState<WebcamStats | null>(null);
  // Seeded from the add-time value, but kept in sync with the backend's
  // actual live threshold via the stats poll below — a plain one-time
  // useState(camera.confidence) would go stale (and could get silently
  // overwritten back to the add-time value) if this component ever
  // remounts, e.g. when toggling expand/collapse.
  const [confidence, setConfidence] = useState(camera.confidence);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await getCameraStats(camera.id);
        if (cancelled) return;
        setStats(result);
        if (result.confidence !== undefined) setConfidence(result.confidence);
      } catch {
        // transient — the tile just keeps showing the last known stats
      }
    }

    poll();
    const interval = setInterval(poll, STATS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [camera.id]);

  const handleConfidenceChange = (value: number) => {
    setConfidence(value);
    setCameraConfidence(camera.id, value).catch(() => {});
  };

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-black/50 ring-1 ring-white/10 ${large ? "aspect-video w-full" : "aspect-video"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cameraStreamUrl(camera.id)}
        alt={`Live annotated feed: ${camera.name}`}
        onClick={() => onToggleExpand(camera.id)}
        className="h-full w-full cursor-pointer object-contain"
      />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-slate-200">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          {camera.name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onToggleExpand(camera.id)}
            title={isExpanded ? "Back to grid" : "Expand"}
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-cyan-300"
          >
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
          <button
            onClick={() => onStop(camera.id)}
            title="Stop camera"
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        </div>
      </div>
      <div className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
        Bags: {stats?.bag_count ?? 0}
      </div>
      <div
        className="absolute inset-x-1.5 bottom-1.5 flex justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-36 rounded-full bg-black/60 px-2.5 py-1 ring-1 ring-inset ring-white/10">
          <ConfidenceSlider value={confidence} onChange={handleConfidenceChange} label="" />
        </div>
      </div>
    </div>
  );
}

interface CameraGridProps {
  cameras: CameraSummary[];
  layout: number;
  onStopCamera: (id: string) => void;
}

export function CameraGrid({ cameras, layout, onStopCamera }: CameraGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (cameras.length === 0) return null;

  const expanded = cameras.find((c) => c.id === expandedId) ?? null;
  const toggleExpand = (id: string) => setExpandedId((current) => (current === id ? null : id));

  if (expanded) {
    return (
      <CameraTile
        camera={expanded}
        large
        onStop={onStopCamera}
        onToggleExpand={toggleExpand}
        isExpanded
      />
    );
  }

  return (
    <div className={`grid w-full gap-2 ${GRID_CLASS[layout] ?? GRID_CLASS[4]}`}>
      {cameras.slice(0, layout).map((camera) => (
        <CameraTile
          key={camera.id}
          camera={camera}
          onStop={onStopCamera}
          onToggleExpand={toggleExpand}
          isExpanded={false}
        />
      ))}
    </div>
  );
}
