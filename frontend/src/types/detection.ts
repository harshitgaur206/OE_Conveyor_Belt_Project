export type DetectionMode = "image" | "video" | "webcam" | "history";

// Which camera a "webcam" (Live) session actually reads from: the viewer's
// own device (captured in-browser, pushed to the backend over a WebSocket),
// or one or more network/RTSP cameras that only the backend machine can reach.
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

// The browser-camera path (/ws/detect, useBrowserCameraDetection) has no
// persistent server-side session to query a threshold from, so its stats
// never carry `confidence` — only /cameras/{id}/stats does. Optional here
// would conflict with CameraSummary.confidence (always present) when
// CameraSession extends both, so this is typed as always-present and the
// (nonexistent) browser-camera caller simply never constructs this shape
// with a confidence field, which is fine since nothing reads it there.
export interface WebcamStats {
  active: boolean;
  bag_count: number;
  confidence_avg: number;
  fps: number;
  updated_at: number | null;
  // The detection confidence *threshold* currently in effect for this
  // camera — distinct from confidence_avg (the average score of what was
  // actually detected).
  confidence: number;
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

// A point of a region-of-interest polygon, normalized to 0-1 against the
// frame it was drawn on (so it stays valid across a resolution mismatch
// between the still preview and the live stream).
export type ROIPoint = [number, number];

export interface FramePreviewResponse {
  frame_base64: string;
}

export interface CameraSummary {
  id: string;
  name: string;
  rtsp_url: string;
  confidence: number;
}

// A registered network camera, as returned by GET /cameras (identity +
// its latest live stats merged into one object).
export interface CameraSession extends CameraSummary, WebcamStats {}

export type GridLayout = 1 | 2 | 4 | 6 | 9;

export type HistorySourceType = "image" | "video" | "rtsp" | "browser";

export interface HistoryRecord {
  id: string;
  source_type: HistorySourceType;
  source_name: string;
  started_at: number;
  ended_at: number;
  bag_count: number;
  confidence_avg: number;
  frame_count: number | null;
  roi_used: boolean;
  annotated_media_path: string | null;
}
