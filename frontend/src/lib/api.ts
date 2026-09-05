import type {
  CameraSession,
  CameraSummary,
  FramePreviewResponse,
  HealthResponse,
  HistoryRecord,
  ImageDetectionResponse,
  ROIPoint,
  StreamCheckResponse,
  VideoDetectionResponse,
  WebcamStats,
} from "@/types/detection";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError("Backend unreachable. Please check the server.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(detail || `Request failed with status ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { signal });
}

function appendRoiAndConfidence(formData: FormData, roiPoints?: ROIPoint[], confidence?: number): void {
  if (roiPoints && roiPoints.length >= 3) {
    formData.append("roi_points", JSON.stringify(roiPoints));
  }
  if (confidence !== undefined) {
    formData.append("confidence", String(confidence));
  }
}

export function detectImage(
  file: File,
  roiPoints?: ROIPoint[],
  confidence?: number
): Promise<ImageDetectionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  appendRoiAndConfidence(formData, roiPoints, confidence);
  return request<ImageDetectionResponse>("/detect/image", {
    method: "POST",
    body: formData,
  });
}

export function detectVideo(
  file: File,
  roiPoints?: ROIPoint[],
  confidence?: number
): Promise<VideoDetectionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  appendRoiAndConfidence(formData, roiPoints, confidence);
  return request<VideoDetectionResponse>("/detect/video", {
    method: "POST",
    body: formData,
  });
}

// Returns just the first frame of an uploaded image/video, with no
// detection run — used to show the user something to draw an ROI on
// before the real /detect/image or /detect/video call.
export function getFirstFramePreview(file: File): Promise<FramePreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<FramePreviewResponse>("/roi/preview", {
    method: "POST",
    body: formData,
  });
}

// ws:// (or wss:// when the API is served over https) URL for the
// browser-camera live-detection socket. Kept alongside the /cameras/*
// endpoints (the network/RTSP camera path) since the two are genuinely
// different capture sources hitting different backend endpoints.
export function liveDetectWebSocketUrl(): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/ws/detect`;
}

export function checkStreamSource(source: string, signal?: AbortSignal): Promise<StreamCheckResponse> {
  return request<StreamCheckResponse>(`/stream/check?source=${encodeURIComponent(source)}`, { signal });
}

// Each network camera below runs as its own independent backend session
// (own detector/tracker), so any number of these can be created and
// streamed side by side — unlike the single shared-detector browser-camera
// path above.
export function createCamera(name: string, rtspUrl: string, confidence?: number): Promise<CameraSummary> {
  return request<CameraSummary>("/cameras", jsonBody({ name, rtsp_url: rtspUrl, confidence }));
}

export function listCameras(signal?: AbortSignal): Promise<CameraSession[]> {
  return request<CameraSession[]>("/cameras", { signal });
}

export function getCameraPreview(id: string): Promise<FramePreviewResponse> {
  return request<FramePreviewResponse>(`/cameras/${id}/preview`);
}

export function setCameraRoi(id: string, points: ROIPoint[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/cameras/${id}/roi`, jsonBody({ points }));
}

export function setCameraConfidence(id: string, value: number | null): Promise<{ confidence: number }> {
  return request<{ confidence: number }>(`/cameras/${id}/confidence`, jsonBody({ value }));
}

export function cameraStreamUrl(id: string): string {
  return `${API_BASE_URL}/cameras/${id}/stream`;
}

export function getCameraStats(id: string, signal?: AbortSignal): Promise<WebcamStats> {
  return request<WebcamStats>(`/cameras/${id}/stats`, { signal });
}

export interface StopCameraResponse {
  stopped: boolean;
  bag_count: number;
  confidence_avg: number;
  frame_count: number;
  started_at: number;
  ended_at: number;
}

export function stopCamera(id: string): Promise<StopCameraResponse> {
  return request(`/cameras/${id}/stop`, { method: "POST" });
}

export function getHistory(params?: {
  sourceType?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<HistoryRecord[]> {
  const search = new URLSearchParams();
  if (params?.sourceType) search.set("source_type", params.sourceType);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return request<HistoryRecord[]>(`/history${qs ? `?${qs}` : ""}`, { signal: params?.signal });
}

export function deleteHistoryRecord(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/history/${id}`, { method: "DELETE" });
}

export function mediaUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export { ApiError };
