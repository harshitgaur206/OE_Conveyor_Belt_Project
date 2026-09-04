"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { ControlPanel } from "@/components/ControlPanel";
import { Viewer } from "@/components/Viewer";
import { StatsPanel } from "@/components/StatsPanel";
import {
  ApiError,
  checkHealth,
  detectImage,
  detectVideo,
  fetchWebcamStats,
  mediaUrl,
  stopWebcamStream,
  webcamStreamUrl,
} from "@/lib/api";
import { useBrowserCameraDetection } from "@/lib/useBrowserCameraDetection";
import type { DetectionMode, DetectionStats, HealthResponse, LiveSource } from "@/types/detection";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const WEBCAM_STATS_POLL_INTERVAL_MS = 1_000;

export default function DashboardPage() {
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "disconnected">(
    "checking"
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [mode, setMode] = useState<DetectionMode>("image");
  const [file, setFile] = useState<File | null>(null);
  const [liveSource, setLiveSource] = useState<LiveSource>("browser");
  const [rtspUrl, setRtspUrl] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [webcamSrc, setWebcamSrc] = useState<string | null>(null);
  const [stats, setStats] = useState<DetectionStats | null>(null);

  const browserCamera = useBrowserCameraDetection();
  const isLiveActive = liveSource === "browser" ? browserCamera.isActive : isStreaming;

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

  // Poll live stats while the network-camera MJPEG stream is active. The
  // browser-camera path gets its stats directly on each WebSocket message
  // instead (see useBrowserCameraDetection), so it doesn't need this poll.
  useEffect(() => {
    if (!isStreaming || liveSource !== "network") return;
    let cancelled = false;

    async function poll() {
      try {
        const result = await fetchWebcamStats();
        if (cancelled) return;
        setStats({
          bagCount: result.bag_count,
          latencyMs: result.fps > 0 ? 1000 / result.fps : 0,
          confidenceAvg: result.confidence_avg,
        });
      } catch {
        // transient — the health poller will surface a sustained outage
      }
    }

    poll();
    const interval = setInterval(poll, WEBCAM_STATS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isStreaming, liveSource]);

  const handleModeChange = useCallback(
    (nextMode: DetectionMode) => {
      if (isStreaming) {
        stopWebcamStream().catch(() => {});
        setIsStreaming(false);
        setWebcamSrc(null);
      }
      browserCamera.stop();
      setMode(nextMode);
      setFile(null);
      setImageSrc(null);
      setVideoSrc(null);
      setStats(null);
    },
    [isStreaming, browserCamera]
  );

  const handleLiveSourceChange = useCallback(
    (nextSource: LiveSource) => {
      if (isStreaming) {
        stopWebcamStream().catch(() => {});
        setIsStreaming(false);
        setWebcamSrc(null);
      }
      browserCamera.stop();
      setStats(null);
      setLiveSource(nextSource);
    },
    [isStreaming, browserCamera]
  );

  const handleRunDetection = useCallback(async () => {
    if (connectionState === "disconnected") {
      toast.error("Backend unreachable. Please check the server.");
      return;
    }

    if (mode === "webcam") {
      if (liveSource === "browser") {
        setStats(null);
        await browserCamera.start();
        return;
      }
      setWebcamSrc(webcamStreamUrl(rtspUrl || undefined));
      setIsStreaming(true);
      return;
    }

    if (!file) return;
    setIsRunning(true);
    setStats(null);

    try {
      if (mode === "image") {
        const result = await detectImage(file);
        setImageSrc(`data:image/jpeg;base64,${result.annotated_image_base64}`);
        setStats({
          bagCount: result.bag_count,
          latencyMs: result.latency,
          confidenceAvg: result.confidence_avg,
        });
      } else {
        const result = await detectVideo(file);
        setVideoSrc(mediaUrl(result.annotated_video_url));
        setStats({
          bagCount: result.bag_count,
          latencyMs: result.latency,
          confidenceAvg: result.confidence_avg,
        });
      }
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Detection failed unexpectedly.";
      toast.error(message);
    } finally {
      setIsRunning(false);
    }
  }, [connectionState, file, mode, rtspUrl, liveSource, browserCamera]);

  const handleStopStream = useCallback(async () => {
    if (liveSource === "browser") {
      browserCamera.stop();
      return;
    }
    setIsStreaming(false);
    setWebcamSrc(null);
    try {
      await stopWebcamStream();
    } catch {
      // backend may already be down; header indicator covers that case
    }
  }, [liveSource, browserCamera]);

  const displayStats = mode === "webcam" && liveSource === "browser" ? browserCamera.stats : stats;

  return (
    <div className="flex min-h-screen flex-col">
      <Header connectionState={connectionState} health={health} />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-8">
        <StatsPanel stats={displayStats} />

        <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <ControlPanel
            mode={mode}
            onModeChange={handleModeChange}
            file={file}
            onFileSelected={setFile}
            liveSource={liveSource}
            onLiveSourceChange={handleLiveSourceChange}
            rtspUrl={rtspUrl}
            onRtspUrlChange={setRtspUrl}
            onRunDetection={handleRunDetection}
            isRunning={isRunning}
            isStreaming={isLiveActive}
            onStopStream={handleStopStream}
            disabled={connectionState === "disconnected"}
          />

          <Viewer
            mode={mode}
            isLoading={isRunning}
            imageSrc={imageSrc}
            videoSrc={videoSrc}
            liveSource={liveSource}
            webcamSrc={webcamSrc}
            browserFrameSrc={browserCamera.frameSrc}
            browserCameraError={browserCamera.error}
            browserCalibrating={browserCamera.calibrating}
          />
        </div>
      </main>
    </div>
  );
}
