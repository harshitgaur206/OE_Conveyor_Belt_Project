import type {
  HealthResponse,
  ImageDetectionResponse,
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

export function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { signal });
}

export function detectImage(file: File): Promise<ImageDetectionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<ImageDetectionResponse>("/detect/image", {
    method: "POST",
    body: formData,
  });
}

export function detectVideo(file: File): Promise<VideoDetectionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<VideoDetectionResponse>("/detect/video", {
    method: "POST",
    body: formData,
  });
}

// ws:// (or wss:// when the API is served over https) URL for the
// browser-camera live-detection socket. Kept alongside webcamStreamUrl
// (the network/RTSP camera path) since the two are genuinely different
// capture sources hitting different backend endpoints.
export function liveDetectWebSocketUrl(): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/ws/detect`;
}

export function webcamStreamUrl(rtspUrl?: string): string {
  const params = new URLSearchParams({ ts: String(Date.now()) });
  if (rtspUrl) params.set("rtsp_url", rtspUrl);
  return `${API_BASE_URL}/stream/webcam?${params.toString()}`;
}

export function fetchWebcamStats(signal?: AbortSignal): Promise<WebcamStats> {
  return request<WebcamStats>("/stream/webcam/stats", { signal });
}

export function checkStreamSource(source: string, signal?: AbortSignal): Promise<StreamCheckResponse> {
  return request<StreamCheckResponse>(`/stream/check?source=${encodeURIComponent(source)}`, { signal });
}

export function stopWebcamStream(): Promise<{ stopped: boolean }> {
  return request<{ stopped: boolean }>("/stream/webcam/stop", { method: "POST" });
}

export function mediaUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export { ApiError };
