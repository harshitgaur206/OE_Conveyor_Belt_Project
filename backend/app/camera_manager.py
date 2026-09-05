"""Registry of concurrently-running RTSP/webcam camera sessions.

Each CameraSession owns its own CementBagDetector (own YOLO model + own
ByteTrack tracker + own LineCounter) rather than sharing one across cameras:
ultralytics ties tracker state to a single mutable `model.predictor`
attribute keyed positionally within one batched call, not by an arbitrary
stream id, so two independently-invoked track() calls sharing one model
would race on and corrupt each other's tracker state. One full detector
instance per camera is the safe unit of concurrency (see detector.py).
"""

import threading
import time
import uuid

import cv2

from app.config import get_settings
from app.detector import CementBagDetector


class CameraSession:
    def __init__(self, camera_id: str, name: str, rtsp_url: str):
        self.id = camera_id
        self.name = name
        self.rtsp_url = rtsp_url
        self.detector = CementBagDetector()
        self.started_at = time.time()

        self._capture: cv2.VideoCapture | None = None
        self._lock = threading.Lock()
        self._streaming = False  # guards against two concurrent readers corrupting tracker state
        self._frame_count = 0
        self._confidence_sum = 0.0
        self._confidence_samples = 0
        self._latest_stats = {
            "active": False,
            "bag_count": 0,
            "confidence_avg": 0.0,
            "fps": 0.0,
            "updated_at": None,
        }

    def set_roi(self, points: list[tuple[float, float]] | None) -> None:
        self.detector.set_roi(points)

    def preview_frame(self):
        """Opens a short-lived capture, grabs one frame, and releases it --
        used to show the user something to draw an ROI on before the
        persistent stream (and its tracker) starts."""
        capture = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        try:
            if not capture.isOpened():
                raise RuntimeError(f"Could not open camera source: {self.rtsp_url!r}")
            ok, frame = capture.read()
            if not ok or frame is None:
                raise RuntimeError("Could not read a frame from the camera source")
            return frame
        finally:
            capture.release()

    def try_acquire_stream(self) -> bool:
        with self._lock:
            if self._streaming:
                return False
            self._streaming = True
            return True

    def release_stream(self) -> None:
        with self._lock:
            self._streaming = False

    def get_stats(self) -> dict:
        with self._lock:
            return dict(self._latest_stats)

    def frame_generator(self):
        capture = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        if not capture.isOpened():
            capture.release()
            raise RuntimeError(f"Could not open camera source: {self.rtsp_url!r}")

        with self._lock:
            self._capture = capture
            self._latest_stats["active"] = True
        self.detector.reset_tracker()

        skip = max(1, get_settings().webcam_frame_skip)
        frame_index = 0
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break

                frame_index += 1
                if frame_index % skip == 0:
                    start = time.perf_counter()
                    annotated, stats = self.detector.track_frame(frame)
                    elapsed = time.perf_counter() - start

                    self._frame_count += 1
                    if stats["current_detections"]:
                        self._confidence_sum += stats["confidence_avg"]
                        self._confidence_samples += 1

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
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
                )
        finally:
            capture.release()
            with self._lock:
                self._capture = None
                self._latest_stats["active"] = False

    def final_summary(self) -> dict:
        with self._lock:
            bag_count = self._latest_stats["bag_count"]
        return {
            "bag_count": bag_count,
            "confidence_avg": (self._confidence_sum / self._confidence_samples) if self._confidence_samples else 0.0,
            "frame_count": self._frame_count,
            "started_at": self.started_at,
            "ended_at": time.time(),
        }


class CameraManager:
    def __init__(self, max_concurrent: int):
        self._sessions: dict[str, CameraSession] = {}
        self._max_concurrent = max_concurrent
        self._lock = threading.Lock()

    def create(self, name: str, rtsp_url: str) -> CameraSession:
        with self._lock:
            if len(self._sessions) >= self._max_concurrent:
                raise RuntimeError(
                    f"Maximum of {self._max_concurrent} concurrent cameras already active"
                )
            camera_id = uuid.uuid4().hex
            session = CameraSession(camera_id, name, rtsp_url)
            self._sessions[camera_id] = session
            return session

    def get(self, camera_id: str) -> CameraSession | None:
        return self._sessions.get(camera_id)

    def list(self) -> list[CameraSession]:
        return list(self._sessions.values())

    def remove(self, camera_id: str) -> CameraSession | None:
        with self._lock:
            return self._sessions.pop(camera_id, None)

    def stop_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            with session._lock:
                capture = session._capture
            if capture is not None:
                capture.release()
