"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ScanEye, Camera, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ROICanvas } from "@/components/ROICanvas";
import { CameraGrid } from "@/components/CameraGrid";
import { CameraDashboard } from "@/components/CameraDashboard";
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

  // The raw file mid-upload, shown faintly behind the "Running inference"
  // overlay so the view isn't just a blank spinner — see pendingFileSrc below.
  pendingFile: File | null;

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

// Object URL for the file currently mid-upload, so the loading state can
// show it (very faint) instead of a flat blank background. Scoped to this
// hook so the URL is reliably revoked when the file changes/clears.
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Genuine external-resource sync, not derivable without an effect:
    // URL.createObjectURL/revokeObjectURL must be paired (leaking a blob
    // URL otherwise), and the pairing only works via an effect's cleanup
    // running before the next one fires on file change/unmount.
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function FullscreenButton({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      targetRef.current?.requestFullscreen().catch(() => {});
    }
  };

  return (
    <button
      onClick={toggle}
      title={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
      className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
    >
      {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
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
  pendingFile,
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
  const imageResultRef = useRef<HTMLDivElement>(null);
  const videoResultRef = useRef<HTMLVideoElement>(null);
  const pendingFileSrc = useObjectUrl(isLoading ? pendingFile : null);

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
    <Card className="relative flex min-h-[420px] flex-1 items-center justify-center overflow-hidden bg-bg-subtle/30">
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
              {pendingFileSrc && mode === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pendingFileSrc}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-contain opacity-10"
                />
              )}
              {pendingFileSrc && mode === "video" && (
                <video
                  src={pendingFileSrc}
                  muted
                  autoPlay
                  loop
                  playsInline
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-contain opacity-10"
                />
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 overflow-hidden opacity-60">
                <div className="scan-line h-full w-full bg-gradient-to-b from-transparent via-accent/25 to-transparent" />
              </div>
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-overlay backdrop-blur-sm">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
                <p className="font-mono text-xs uppercase tracking-wider text-text-muted">
                  Running inference<span className="animate-pulse">...</span>
                </p>
              </div>
            </>
          )}

          {!hasContent && !isLoading && awaitingBrowserCamera && (
            <div className="flex flex-col items-center gap-3 text-text-faint">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-subtle ring-1 ring-border">
                <Camera className="h-8 w-8 animate-pulse" />
              </div>
              <p className="font-mono text-xs uppercase tracking-wider text-text-faint">
                Starting camera — allow permission if prompted
              </p>
            </div>
          )}

          {!hasContent && !isLoading && !awaitingBrowserCamera && (
            <div className="flex flex-col items-center gap-3 text-text-faint">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-subtle ring-1 ring-border">
                <ScanEye className="h-8 w-8" />
              </div>
              <p className="font-mono text-xs uppercase tracking-wider text-text-faint">
                {mode === "webcam" && browserCameraError
                  ? browserCameraError
                  : isNetworkGrid
                    ? "No cameras added yet"
                    : "Awaiting input signal"}
              </p>
            </div>
          )}

          {mode === "image" && imageSrc && (
            <div ref={imageResultRef} className="relative flex w-full items-center justify-center bg-black">
              <FullscreenButton targetRef={imageResultRef} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageSrc}
                alt="Annotated detection result"
                className="max-h-[calc(70vh-3rem)] w-full object-contain transition-opacity duration-300"
              />
            </div>
          )}

          {mode === "video" && videoSrc && (
            <div className="relative w-full">
              <FullscreenButton targetRef={videoResultRef} />
              <video
                ref={videoResultRef}
                key={videoSrc}
                src={videoSrc}
                controls
                autoPlay
                loop
                className="max-h-[calc(70vh-3rem)] w-full bg-black object-contain transition-opacity duration-300"
              />
            </div>
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
            <div className="flex h-full w-full flex-col gap-3 overflow-auto p-3">
              <CameraDashboard cameras={cameras} />
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
