"use client";

import { useRef, useState } from "react";
import { Check, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceSlider, DEFAULT_CONFIDENCE } from "@/components/ConfidenceSlider";
import type { ROIPoint } from "@/types/detection";

interface ROICanvasProps {
  previewSrc: string;
  onConfirm: (points: ROIPoint[], confidence: number) => void;
  onSkip: (confidence: number) => void;
  initialConfidence?: number;
}

const MIN_POINTS = 3;

// Points are tracked in on-screen pixel space (relative to the container
// that exactly wraps the rendered <img>), then normalized to 0-1 fractions
// only at confirm time — re-measuring the container then instead of caching
// its size keeps this correct across a window resize mid-draw.
export function ROICanvas({ previewSrc, onConfirm, onSkip, initialConfidence }: ROICanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [points, setPoints] = useState<ROIPoint[]>([]);
  const [confidence, setConfidence] = useState(initialConfidence ?? DEFAULT_CONFIDENCE);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPoints((prev) => [...prev, [event.clientX - rect.left, event.clientY - rect.top]]);
  };

  const handleConfirm = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || points.length < MIN_POINTS) return;
    onConfirm(
      points.map(([x, y]) => [x / rect.width, y / rect.height]),
      confidence
    );
  };

  const polygonStr = points.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <div
        ref={containerRef}
        onClick={handleClick}
        className="relative max-h-[60vh] w-full max-w-full cursor-crosshair overflow-hidden rounded-lg ring-1 ring-border"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewSrc}
          alt="Draw a region of interest"
          className="block max-h-[60vh] w-full select-none object-contain"
          draggable={false}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {points.length > 1 && (
            <polygon points={polygonStr} className="fill-accent/20 stroke-accent" strokeWidth={2} />
          )}
          {points.map(([x, y], index) => (
            <circle key={index} cx={x} cy={y} r={4} className="fill-accent" />
          ))}
        </svg>
      </div>

      <p className="text-center font-mono text-[11px] uppercase tracking-wider text-text-faint">
        Click to outline the belt area — needs at least {MIN_POINTS} points
      </p>

      <div className="w-full max-w-xs">
        <ConfidenceSlider value={confidence} onChange={setConfidence} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => setPoints([])} disabled={points.length === 0}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <Button variant="outline" onClick={() => onSkip(confidence)}>
          <SkipForward className="h-3.5 w-3.5" />
          Skip (use full frame)
        </Button>
        <Button onClick={handleConfirm} disabled={points.length < MIN_POINTS}>
          <Check className="h-3.5 w-3.5" />
          Confirm ROI
        </Button>
      </div>
    </div>
  );
}
