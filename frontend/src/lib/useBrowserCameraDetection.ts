"use client";

import { useCallback, useRef, useState } from "react";
import { liveDetectWebSocketUrl } from "@/lib/api";
import type { DetectionStats, LiveDetectionFrame, ROIPoint } from "@/types/detection";

// Round-trips a captured frame roughly 5x/second. The backend serializes
// every live frame through one lock around a single YOLO+ByteTrack instance
// (see backend/app/main.py), so this stays modest rather than maxing out
// requestAnimationFrame — a faster capture rate would just queue up behind
// inference that can't keep pace anyway.
const CAPTURE_INTERVAL_MS = 200;
const JPEG_QUALITY = 0.75;

interface UseBrowserCameraDetectionResult {
  isActive: boolean;
  error: string | null;
  frameSrc: string | null;
  stats: DetectionStats | null;
  calibrating: boolean;
  // Acquires the camera and returns one snapshot as a data URL, without
  // starting detection — used to show the user something to draw an ROI on.
  capturePreview: () => Promise<string | null>;
  start: (roiPoints?: ROIPoint[], confidence?: number) => Promise<void>;
  stop: () => void;
}

export function useBrowserCameraDetection(): UseBrowserCameraDetectionResult {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  const cleanup = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    videoRef.current = null;
    canvasRef.current = null;
    inFlightRef.current = false;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setIsActive(false);
    setFrameSrc(null);
    setStats(null);
    setCalibrating(false);
  }, [cleanup]);

  // Acquires the camera and prepares the offscreen video/canvas pair used to
  // grab frames, without opening the detection socket. Idempotent — reuses
  // an already-acquired stream (e.g. from a prior capturePreview() call)
  // instead of prompting for camera permission a second time.
  const ensureCapture = useCallback(async (): Promise<{
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } | null> => {
    if (streamRef.current && videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) return { video: videoRef.current, canvas: canvasRef.current, ctx };
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support camera access.");
      return null;
    }
    if (!window.isSecureContext) {
      setError("Camera access requires HTTPS (or localhost) — this page was loaded over an insecure origin.");
      return null;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch {
      setError("Camera access was denied, or no camera is available on this device.");
      return null;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Some browsers require a user gesture; the click that triggered this
      // already counts as one, so this is rarely hit.
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stream.getTracks().forEach((track) => track.stop());
      setError("Could not initialize frame capture on this device.");
      return null;
    }

    streamRef.current = stream;
    videoRef.current = video;
    canvasRef.current = canvas;
    return { video, canvas, ctx };
  }, []);

  const capturePreview = useCallback(async (): Promise<string | null> => {
    setError(null);
    const capture = await ensureCapture();
    if (!capture) return null;
    const { video, canvas, ctx } = capture;

    // The video element may not have decoded a frame yet right after
    // play() resolves — wait briefly for real dimensions before drawing.
    const waitStart = Date.now();
    while (video.videoWidth === 0 && Date.now() - waitStart < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (video.videoWidth === 0) {
      setError("Could not read a frame from the camera.");
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, [ensureCapture]);

  const start = useCallback(
    async (roiPoints?: ROIPoint[], confidence?: number) => {
      setError(null);
      const capture = await ensureCapture();
      if (!capture) return;
      const { ctx } = capture;

      let socket: WebSocket;
      try {
        socket = new WebSocket(liveDetectWebSocketUrl());
      } catch {
        cleanup();
        setError("Could not open the live-detection connection.");
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        const control: { roi?: ROIPoint[]; confidence?: number } = {};
        if (roiPoints && roiPoints.length >= 3) control.roi = roiPoints;
        if (confidence !== undefined) control.confidence = confidence;
        if (Object.keys(control).length > 0) socket.send(JSON.stringify(control));
        setIsActive(true);
        intervalRef.current = setInterval(() => {
          // Skip a tick if the previous frame hasn't round-tripped yet —
          // simple backpressure so a slow (e.g. CPU-only) backend doesn't
          // build up an ever-growing backlog of unsent frames.
          if (inFlightRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.videoWidth === 0 || socket.readyState !== WebSocket.OPEN) return;

          c.width = v.videoWidth;
          c.height = v.videoHeight;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(
            (blob) => {
              if (!blob || socket.readyState !== WebSocket.OPEN) return;
              inFlightRef.current = true;
              blob.arrayBuffer().then((buf) => {
                if (socket.readyState === WebSocket.OPEN) socket.send(buf);
              });
            },
            "image/jpeg",
            JPEG_QUALITY
          );
        }, CAPTURE_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        inFlightRef.current = false;
        try {
          const data: LiveDetectionFrame = JSON.parse(event.data);
          setFrameSrc(`data:image/jpeg;base64,${data.annotated_image_base64}`);
          setCalibrating(data.calibrating);
          setStats({
            bagCount: data.bag_count,
            latencyMs: data.latency_ms,
            confidenceAvg: data.confidence_avg,
          });
        } catch {
          // malformed frame — drop it, the next one will arrive shortly
        }
      };

      socket.onerror = () => {
        setError("Live detection connection failed.");
      };

      socket.onclose = (event) => {
        inFlightRef.current = false;
        setIsActive(false);
        // 1013 is the app-level "busy" close code the backend sends when a
        // live session is already running elsewhere (see main.py); surface
        // its reason since the generic browser close event doesn't.
        if (event.code === 1013) {
          setError(event.reason || "Another live session is already active on the backend.");
        }
      };
    },
    [ensureCapture, cleanup]
  );

  return { isActive, error, frameSrc, stats, calibrating, capturePreview, start, stop };
}
