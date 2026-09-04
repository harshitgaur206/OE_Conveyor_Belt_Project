"""Live source capture (local webcam device or RTSP stream) + MJPEG streaming.

The browser cannot hand its own webcam feed to a plain GET endpoint, so this
opens a capture on the machine running this backend (cv2.VideoCapture) and
streams annotated frames back as multipart/x-mixed-replace. cv2.VideoCapture
accepts an RTSP URL directly (via its bundled FFmpeg backend), so the same
code path serves both a local webcam and an IP camera / NVR RTSP feed — the
caller just passes a different `source`. For a deployment where the camera
lives on the client instead, replace this with a WebSocket endpoint that
accepts frames pushed from the browser.
"""

import threading
import time

import cv2

from app.config import get_settings
from app.detector import CementBagDetector

Source = int | str


def probe_source(source: Source, read_timeout_frames: int = 1) -> dict:
    """Opens `source`, tries to read a frame, and reports back — without
    starting a persistent stream. Used to answer "is this RTSP URL/camera
    reachable at all" without committing to a full annotated stream.
    """
    start = time.perf_counter()
    capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG) if isinstance(source, str) else cv2.VideoCapture(source)
    try:
        opened = capture.isOpened()
        frame_read = False
        width = height = 0
        fps = 0.0
        if opened:
            for _ in range(max(1, read_timeout_frames)):
                frame_read, _frame = capture.read()
                if frame_read:
                    break
            width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = capture.get(cv2.CAP_PROP_FPS)
        return {
            "source": str(source),
            "opened": opened,
            "frame_read": frame_read,
            "width": width,
            "height": height,
            "fps": fps,
            "elapsed_ms": round((time.perf_counter() - start) * 1000, 1),
        }
    finally:
        capture.release()


class LiveStreamManager:
    def __init__(self, detector: CementBagDetector):
        self._detector = detector
        self._settings = get_settings()
        self._capture: cv2.VideoCapture | None = None
        self._lock = threading.Lock()
        self._latest_stats = {
            "active": False,
            "bag_count": 0,
            "confidence_avg": 0.0,
            "fps": 0.0,
            "updated_at": None,
        }

    @property
    def is_active(self) -> bool:
        return self._capture is not None and self._capture.isOpened()

    def start(self, source: Source | None = None):
        with self._lock:
            if self._capture is None or not self._capture.isOpened():
                resolved = source if source is not None else self._settings.webcam_index
                capture = (
                    cv2.VideoCapture(resolved, cv2.CAP_FFMPEG)
                    if isinstance(resolved, str)
                    else cv2.VideoCapture(resolved)
                )
                if not capture.isOpened():
                    capture.release()
                    raise RuntimeError(f"Could not open video source: {resolved!r}")
                self._capture = capture
                self._detector.reset_tracker()
                self._latest_stats = {
                    "active": True,
                    "bag_count": 0,
                    "confidence_avg": 0.0,
                    "fps": 0.0,
                    "updated_at": time.time(),
                }

    def stop(self):
        with self._lock:
            if self._capture is not None:
                self._capture.release()
                self._capture = None
            self._latest_stats["active"] = False

    def get_stats(self) -> dict:
        with self._lock:
            return dict(self._latest_stats)

    def frame_generator(self, source: Source | None = None):
        self.start(source)
        skip = max(1, self._settings.webcam_frame_skip)
        frame_index = 0
        try:
            while True:
                with self._lock:
                    capture = self._capture
                if capture is None:
                    break
                ok, frame = capture.read()
                if not ok:
                    break

                frame_index += 1
                start = time.perf_counter()
                if frame_index % skip == 0:
                    annotated, stats = self._detector.track_frame(frame)
                    elapsed = time.perf_counter() - start
                    with self._lock:
                        self._latest_stats = {
                            "active": True,
                            "bag_count": stats["line_crossing_count"],
                            "confidence_avg": stats["confidence_avg"],
                            "fps": (1.0 / elapsed) if elapsed > 0 else 0.0,
                            "updated_at": time.time(),
                        }
                else:
                    annotated = frame

                ok, buffer = cv2.imencode(".jpg", annotated)
                if not ok:
                    continue
                jpeg_bytes = buffer.tobytes()
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
                )
        finally:
            self.stop()
