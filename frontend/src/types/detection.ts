export type DetectionMode = "image" | "video" | "webcam";

// Which camera a "webcam" (Live) session actually reads from: the viewer's
// own device (captured in-browser, pushed to the backend over a WebSocket),
// or a network/RTSP camera that only the backend machine can reach.
export type LiveSource = "browser" | "network";

export interface HealthResponse {
  status: "ok" | "degraded";
  model_loaded: boolean;
  model_path: string;
}

export interface ImageDetectionResponse {
  annotated_image_base64: string;
  bag_count: number;
  latency: number;
  confidence_avg: number;
}

export interface VideoDetectionResponse {
  annotated_video_url: string;
  bag_count: number;
  frame_count: number;
  latency: number;
  confidence_avg: number;
}

export interface WebcamStats {
  active: boolean;
  bag_count: number;
  confidence_avg: number;
  fps: number;
  updated_at: number | null;
}

export interface StreamCheckResponse {
  source: string;
  opened: boolean;
  frame_read: boolean;
  width: number;
  height: number;
  fps: number;
  elapsed_ms: number;
}

export interface DetectionStats {
  bagCount: number;
  latencyMs: number;
  confidenceAvg: number;
}

// One frame's worth of response from /ws/detect (browser-camera live mode).
export interface LiveDetectionFrame {
  annotated_image_base64: string;
  bag_count: number;
  confidence_avg: number;
  latency_ms: number;
  calibrating: boolean;
}
