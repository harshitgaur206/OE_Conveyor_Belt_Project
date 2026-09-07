"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { ControlPanel } from "@/components/ControlPanel";
import { Viewer } from "@/components/Viewer";
import { StatsPanel } from "@/components/StatsPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_CONFIDENCE } from "@/components/ConfidenceSlider";
import {
  ApiError,
  checkHealth,
  createCamera,
  detectImage,
  detectVideo,
  getCameraPreview,
  getFirstFramePreview,
  mediaUrl,
  setCameraConfidence,
  setCameraRoi,
  stopCamera,
} from "@/lib/api";
import { useBrowserCameraDetection } from "@/lib/useBrowserCameraDetection";
import type {
  CameraSummary,
  DetectionMode,
  DetectionStats,
  GridLayout,
  HealthResponse,
  LiveSource,
  ROIPoint,
} from "@/types/detection";

const HEALTH_POLL_INTERVAL_MS = 15_000;

type PendingRoi = { kind: "image" | "video" } | { kind: "camera"; camera: CameraSummary } | { kind: "browser" };

export default function DashboardPage() {
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "disconnected">(
    "checking"
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [mode, setMode] = useState<DetectionMode>("image");
  const [file, setFile] = useState<File | null>(null);
  const [liveSource, setLiveSource] = useState<LiveSource>("browser");
  const [isRunning, setIsRunning] = useState(false);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [stats, setStats] = useState<DetectionStats | null>(null);

  // Remembered so the confidence-adjust bar under an image/video result can
  // re-run detection on the same file + ROI without asking the user to
  // redraw anything — only the threshold changes between runs.
  const [lastRoiPoints, setLastRoiPoints] = useState<ROIPoint[] | undefined>(undefined);
  const [resultConfidence, setResultConfidence] = useState(DEFAULT_CONFIDENCE);

  const [cameras, setCameras] = useState<CameraSummary[]>([]);
  const [isAddingCamera, setIsAddingCamera] = useState(false);
  const [gridLayout, setGridLayout] = useState<GridLayout>(4);

  const [pendingRoi, setPendingRoi] = useState<PendingRoi | null>(null);
  const [roiPreviewSrc, setRoiPreviewSrc] = useState<string | null>(null);

  const browserCamera = useBrowserCameraDetection();

  const wasDisconnected = useRef(false);

  // Release the camera/socket if the user navigates away mid-stream.
  useEffect(() => {
    return () => browserCamera.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (browserCamera.error) toast.error(browserCamera.error);
  }, [browserCamera.error]);

  // Ping /health on load and on an interval; flip the header indicator and
  // toast once when the backend transitions to unreachable.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await checkHealth();
        if (cancelled) return;
        setHealth(result);
        setConnectionState("connected");
        if (wasDisconnected.current) {
          toast.success("Backend connection restored.");
          wasDisconnected.current = false;
        }
      } catch {
        if (cancelled) return;
        setConnectionState("disconnected");
        setHealth(null);
        if (!wasDisconnected.current) {
          toast.error("Backend unreachable. Please check the server.");
          wasDisconnected.current = true;
        }
      }
    }

    poll();
    const interval = setInterval(poll, HEALTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const cancelPendingRoi = useCallback(() => {
    setPendingRoi((current) => {
      if (current?.kind === "camera") {
        stopCamera(current.camera.id).catch(() => {});
      }
      return null;
    });
    setRoiPreviewSrc(null);
  }, []);

  // Network/RTSP cameras are independent backend-side sessions (see
  // camera_manager.py) — they keep running and counting regardless of which
  // frontend tab is showing, so switching modes/tabs must never stop or
  // forget them. Only the browser's own device camera is torn down here: it
  // depends on a getUserMedia stream + WebSocket held open by this page, so
  // it can't outlive navigating away from that view the way a server-side
  // RTSP session can.
  const handleModeChange = useCallback(
    (nextMode: DetectionMode) => {
      if (mode === "webcam" && liveSource === "browser") {
        browserCamera.stop();
      }
      cancelPendingRoi();
      setMode(nextMode);
      setFile(null);
      setImageSrc(null);
      setVideoSrc(null);
      setStats(null);
      setLastRoiPoints(undefined);
    },
    [mode, liveSource, browserCamera, cancelPendingRoi]
  );

  const handleLiveSourceChange = useCallback(
    (nextSource: LiveSource) => {
      if (liveSource === "browser") browserCamera.stop();
      cancelPendingRoi();
      setStats(null);
      setLiveSource(nextSource);
    },
    [liveSource, browserCamera, cancelPendingRoi]
  );

  const runUploadDetection = useCallback(
    async (
      roiPoints: ROIPoint[] | undefined,
      targetMode: "image" | "video",
      targetFile: File,
      confidence: number
    ) => {
      setIsRunning(true);
      try {
        if (targetMode === "image") {
          const result = await detectImage(targetFile, roiPoints, confidence);
          setImageSrc(`data:image/jpeg;base64,${result.annotated_image_base64}`);
          setStats({
            bagCount: result.bag_count,
            latencyMs: result.latency,
            confidenceAvg: result.confidence_avg,
          });
        } else {
          const result = await detectVideo(targetFile, roiPoints, confidence);
          setVideoSrc(mediaUrl(result.annotated_video_url));
          setStats({
            bagCount: result.bag_count,
            latencyMs: result.latency,
            confidenceAvg: result.confidence_avg,
          });
        }
        setLastRoiPoints(roiPoints);
        setResultConfidence(confidence);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Detection failed unexpectedly.";
        toast.error(message);
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  const handleRunDetection = useCallback(async () => {
    if (connectionState === "disconnected") {
      toast.error("Backend unreachable. Please check the server.");
      return;
    }

    if (mode === "webcam") {
      if (liveSource === "browser") {
        setStats(null);
        const preview = await browserCamera.capturePreview();
        if (preview) {
          setRoiPreviewSrc(preview);
          setPendingRoi({ kind: "browser" });
        }
      }
      return;
    }

    if (!file || mode === "history") return;
    setStats(null);
    try {
      const preview = await getFirstFramePreview(file);
      setRoiPreviewSrc(`data:image/jpeg;base64,${preview.frame_base64}`);
      setPendingRoi({ kind: mode });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not read a preview frame.";
      toast.error(message);
    }
  }, [connectionState, mode, liveSource, browserCamera, file]);

  const handleReRunDetection = useCallback(() => {
    if ((mode === "image" || mode === "video") && file) {
      runUploadDetection(lastRoiPoints, mode, file, resultConfidence);
    }
  }, [mode, file, lastRoiPoints, resultConfidence, runUploadDetection]);

  const handleAddCamera = useCallback(async (name: string, rtspUrl: string) => {
    setIsAddingCamera(true);
    try {
      const camera = await createCamera(name, rtspUrl);
      try {
        const preview = await getCameraPreview(camera.id);
        setRoiPreviewSrc(`data:image/jpeg;base64,${preview.frame_base64}`);
        setPendingRoi({ kind: "camera", camera });
      } catch {
        toast.error("Could not fetch a preview frame for this camera — adding it without an ROI.");
        setCameras((prev) => [...prev, camera]);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not add camera.");
    } finally {
      setIsAddingCamera(false);
    }
  }, []);

  const handleStopCamera = useCallback((id: string) => {
    setCameras((prev) => prev.filter((c) => c.id !== id));
    stopCamera(id).catch(() => {});
  }, []);

  const handleRoiConfirm = useCallback(
    async (points: ROIPoint[], confidence: number) => {
      const current = pendingRoi;
      if (!current) return;
      setRoiPreviewSrc(null);
      setPendingRoi(null);

      if (current.kind === "camera") {
        try {
          await setCameraRoi(current.camera.id, points);
          await setCameraConfidence(current.camera.id, confidence);
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : "Could not apply camera settings.");
        }
        setCameras((prev) => [...prev, { ...current.camera, confidence }]);
        return;
      }

      if (current.kind === "browser") {
        await browserCamera.start(points, confidence);
        return;
      }

      if (file) await runUploadDetection(points, current.kind, file, confidence);
    },
    [pendingRoi, file, runUploadDetection, browserCamera]
  );

  const handleRoiSkip = useCallback(
    (confidence: number) => {
      const current = pendingRoi;
      if (!current) return;
      setRoiPreviewSrc(null);
      setPendingRoi(null);

      if (current.kind === "camera") {
        setCameraConfidence(current.camera.id, confidence).catch(() => {});
        setCameras((prev) => [...prev, { ...current.camera, confidence }]);
        return;
      }

      if (current.kind === "browser") {
        browserCamera.start(undefined, confidence);
        return;
      }

      if (file) runUploadDetection(undefined, current.kind, file, confidence);
    },
    [pendingRoi, file, runUploadDetection, browserCamera]
  );

  const handleOpenLiveNetwork = useCallback(() => {
    setMode("webcam");
    setLiveSource("network");
  }, []);

  const handleOpenLiveBrowser = useCallback(() => {
    setMode("webcam");
    setLiveSource("browser");
  }, []);

  const isLiveActive = liveSource === "browser" ? browserCamera.isActive : cameras.length > 0;
  const displayStats =
    mode === "webcam" ? (liveSource === "browser" ? browserCamera.stats : null) : stats;

  return (
    <div className="flex min-h-screen flex-col">
      <Header connectionState={connectionState} health={health} />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8">
        {mode !== "history" && <StatsPanel stats={displayStats} />}

        <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <ControlPanel
            mode={mode}
            onModeChange={handleModeChange}
            file={file}
            onFileSelected={setFile}
            liveSource={liveSource}
            onLiveSourceChange={handleLiveSourceChange}
            onRunDetection={handleRunDetection}
            isRunning={isRunning}
            disabled={connectionState === "disconnected"}
            isBrowserStreaming={liveSource === "browser" && isLiveActive}
            onStopBrowserStream={() => browserCamera.stop()}
            cameras={cameras}
            onAddCamera={handleAddCamera}
            isAddingCamera={isAddingCamera}
            gridLayout={gridLayout}
            onGridLayoutChange={setGridLayout}
          />

          {mode === "history" ? (
            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <CardTitle>Detection History</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                <HistoryPanel
                  activeCameras={cameras}
                  isBrowserCameraActive={browserCamera.isActive}
                  onOpenLiveNetwork={handleOpenLiveNetwork}
                  onOpenLiveBrowser={handleOpenLiveBrowser}
                />
              </CardContent>
            </Card>
          ) : (
            <Viewer
              mode={mode}
              isLoading={isRunning}
              imageSrc={imageSrc}
              videoSrc={videoSrc}
              liveSource={liveSource}
              pendingFile={file}
              browserFrameSrc={browserCamera.frameSrc}
              browserCameraError={browserCamera.error}
              browserCalibrating={browserCamera.calibrating}
              cameras={cameras}
              gridLayout={gridLayout}
              onStopCamera={handleStopCamera}
              roiPreviewSrc={roiPreviewSrc}
              onRoiConfirm={handleRoiConfirm}
              onRoiSkip={handleRoiSkip}
              resultConfidence={resultConfidence}
              onResultConfidenceChange={setResultConfidence}
              onReRunDetection={handleReRunDetection}
            />
          )}
        </div>
      </main>
    </div>
  );
}
