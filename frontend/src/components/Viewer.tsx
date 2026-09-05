"use client";

import { Loader2, ScanEye, Camera, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ROICanvas } from "@/components/ROICanvas";
import { CameraGrid } from "@/components/CameraGrid";
import { ConfidenceSlider } from "@/components/ConfidenceSlider";
import type { CameraSummary, DetectionMode, GridLayout, LiveSource, ROIPoint } from "@/types/detection";

interface ViewerProps {
  mode: DetectionMode;
  isLoading: boolean;
  imageSrc: string | null;
  videoSrc: string | null;
  liveSource: LiveSource;
  browserFrameSrc: string | null;
  browserCameraError: string | null;
  browserCalibrating: boolean;

  cameras: CameraSummary[];
  gridLayout: GridLayout;
  onStopCamera: (id: string) => void;

  roiPreviewSrc: string | null;
  onRoiConfirm: (points: ROIPoint[], confidence: number) => void;
  onRoiSkip: (confidence: number) => void;

  // Lets the user re-run image/video detection with a different confidence
  // threshold without redrawing the ROI or re-uploading the file.
  resultConfidence: number;
  onResultConfidenceChange: (value: number) => void;
  onReRunDetection: () => void;
}

function HudCorners() {
  return (
    <>
      <span className="hud-corner left-3 top-3 border-l-2 border-t-2 rounded-tl-md" />
      <span className="hud-corner right-3 top-3 border-r-2 border-t-2 rounded-tr-md" />
      <span className="hud-corner bottom-3 left-3 border-b-2 border-l-2 rounded-bl-md" />
      <span className="hud-corner bottom-3 right-3 border-b-2 border-r-2 rounded-br-md" />
    </>
  );
}

export function Viewer({
  mode,
  isLoading,
  imageSrc,
  videoSrc,
  liveSource,
  browserFrameSrc,
  browserCameraError,
  browserCalibrating,
  cameras,
  gridLayout,
  onStopCamera,
  roiPreviewSrc,
  onRoiConfirm,
  onRoiSkip,
  resultConfidence,
  onResultConfidenceChange,
  onReRunDetection,
}: ViewerProps) {
  const isNetworkGrid = mode === "webcam" && liveSource === "network";
  const hasContent = isNetworkGrid
    ? cameras.length > 0
    : mode === "webcam"
      ? Boolean(browserFrameSrc)
      : mode === "image"
        ? Boolean(imageSrc)
        : Boolean(videoSrc);
  const awaitingBrowserCamera =
    mode === "webcam" && liveSource === "browser" && !browserFrameSrc && !browserCameraError;
  const showResultConfidenceBar = (mode === "image" || mode === "video") && hasContent && !isLoading;

  return (
    <Card className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden bg-black/40">
      <HudCorners />

      {roiPreviewSrc ? (
        // Deliberately no initialConfidence here: each ROI step (image,
        // video, a new camera, browser camera) is an independent source and
        // should start from the plain default every time — carrying over
        // resultConfidence (which belongs to the image/video re-run bar
        // below) would silently seed an unrelated new camera with whatever
        // threshold the last image/video test happened to end on.
        <ROICanvas previewSrc={roiPreviewSrc} onConfirm={onRoiConfirm} onSkip={onRoiSkip} />
      ) : (
        <>
          {isLoading && (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 overflow-hidden opacity-60">
                <div className="scan-line h-full w-full bg-gradient-to-b from-transparent via-emerald-400/25 to-transparent" />
              </div>
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/85 backdrop-blur-sm">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Running inference<span className="animate-pulse">...</span>
                </p>
              </div>
            </>
          )}

          {!hasContent && !isLoading && awaitingBrowserCamera && (
            <div className="flex flex-col items-center gap-3 text-slate-700">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.02] ring-1 ring-white/5">
                <Camera className="h-8 w-8 animate-pulse" />
              </div>
              <p className="font-mono text-xs uppercase tracking-wider text-slate-600">
                Starting camera — allow permission if prompted
              </p>
            </div>
          )}

          {!hasContent && !isLoading && !awaitingBrowserCamera && (
            <div className="flex flex-col items-center gap-3 text-slate-700">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.02] ring-1 ring-white/5">
                <ScanEye className="h-8 w-8" />
              </div>
              <p className="font-mono text-xs uppercase tracking-wider text-slate-600">
                {mode === "webcam" && browserCameraError
                  ? browserCameraError
                  : isNetworkGrid
                    ? "No cameras added yet"
                    : "Awaiting input signal"}
              </p>
            </div>
          )}

          {mode === "image" && imageSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt="Annotated detection result"
              className="max-h-[calc(70vh-3rem)] w-full object-contain transition-opacity duration-300"
            />
          )}

          {mode === "video" && videoSrc && (
            <video
              key={videoSrc}
              src={videoSrc}
              controls
              autoPlay
              loop
              className="max-h-[calc(70vh-3rem)] w-full object-contain transition-opacity duration-300"
            />
          )}

          {mode === "webcam" && liveSource === "browser" && browserFrameSrc && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={browserFrameSrc}
                alt="Live annotated feed from this device's camera"
                className="max-h-[70vh] w-full object-contain transition-opacity duration-300"
              />
              <span className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-red-400 ring-1 ring-inset ring-red-500/30">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                Live
              </span>
              {browserCalibrating && (
                <span className="absolute right-4 top-4 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-amber-400 ring-1 ring-inset ring-amber-500/30">
                  Calibrating counting line…
                </span>
              )}
            </>
          )}

          {isNetworkGrid && cameras.length > 0 && (
            <div className="h-full w-full overflow-auto p-3">
              <CameraGrid cameras={cameras} layout={gridLayout} onStopCamera={onStopCamera} />
            </div>
          )}

          {showResultConfidenceBar && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/75 px-4 py-2.5 backdrop-blur-sm">
              <div className="flex-1">
                <ConfidenceSlider value={resultConfidence} onChange={onResultConfidenceChange} />
              </div>
              <Button variant="outline" onClick={onReRunDetection} className="shrink-0 px-3 py-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                Re-run
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
