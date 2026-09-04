"""Thin wrapper around the Ultralytics YOLO model used by the upstream
Cement_Bag_Detection_System CLI tool (best.pt), adapted for request/response
and streaming use instead of the original offline video-file workflow.
"""

import base64
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
import torch
from ultralytics import YOLO

from app.config import get_settings
from app.line_counter import LineCounter


@dataclass
class DetectionResult:
    annotated_image_base64: str
    bag_count: int
    latency_ms: float
    confidence_avg: float
    confidences: list[float] = field(default_factory=list)


def _resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    return "cuda:0" if torch.cuda.is_available() else "cpu"


class CementBagDetector:
    """Loads the YOLO model once and reuses it across requests.

    A single ultralytics.YOLO instance is not guaranteed thread-safe for
    concurrent .predict() calls, so callers must serialize access (the
    FastAPI app does this with an asyncio.Lock).
    """

    def __init__(self, model_path: str | None = None):
        settings = get_settings()
        self.device = _resolve_device(settings.device)
        self.model = YOLO(model_path or settings.model_path)
        self.model.to(self.device)
        self.confidence_threshold = settings.confidence_threshold
        self.iou_threshold = settings.iou_threshold
        self.image_size = settings.image_size
        self.tracker_config = settings.tracker_config_path
        self.line_counter = LineCounter(
            orientation=settings.counting_line_orientation,
            line_fraction=settings.counting_line_fraction,
            calibration_min_samples=settings.calibration_min_samples,
            min_hit_streak=settings.min_hit_streak,
        )

    def detect_image(self, image_bgr: np.ndarray) -> DetectionResult:
        start = time.perf_counter()
        results = self.model.predict(
            source=image_bgr,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            imgsz=self.image_size,
            device=self.device,
            verbose=False,
        )
        latency_ms = (time.perf_counter() - start) * 1000

        result = results[0]
        annotated = result.plot()  # BGR np.ndarray with boxes drawn
        confidences = [float(c) for c in result.boxes.conf.tolist()] if result.boxes is not None else []

        ok, buffer = cv2.imencode(".jpg", annotated)
        if not ok:
            raise RuntimeError("Failed to encode annotated image")
        annotated_b64 = base64.b64encode(buffer).decode("utf-8")

        return DetectionResult(
            annotated_image_base64=annotated_b64,
            bag_count=len(confidences),
            latency_ms=latency_ms,
            confidence_avg=(sum(confidences) / len(confidences)) if confidences else 0.0,
            confidences=confidences,
        )

    def track_frame(self, frame_bgr: np.ndarray):
        """Runs detection + ByteTrack tracking on a single frame, for use in
        a streaming loop (webcam / video). Returns (annotated_frame, stats).

        Counts bags by line-crossing, not by tallying distinct track IDs:
        with a low confidence threshold, ByteTrack frequently re-assigns a
        new ID to the same physical bag (occlusion, motion blur, confidence
        dips), so "distinct IDs seen" overcounts badly — a single bag can
        register as 2-4 different tracks. self.line_counter instead counts
        each track once when it crosses a line auto-calibrated to the
        actual observed travel direction (see line_counter.py), so this
        works on any belt orientation/camera placement, not just this one
        demo clip's geometry.
        """
        results = self.model.track(
            source=frame_bgr,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            imgsz=self.image_size,
            device=self.device,
            persist=True,
            tracker=self.tracker_config,
            verbose=False,
        )
        result = results[0]
        annotated = result.plot()
        confidences = [float(c) for c in result.boxes.conf.tolist()] if result.boxes is not None else []
        track_ids = (
            [int(t) for t in result.boxes.id.tolist()]
            if result.boxes is not None and result.boxes.id is not None
            else []
        )

        height, width = frame_bgr.shape[:2]
        centers = result.boxes.xywh[:, :2].tolist() if (track_ids and result.boxes is not None) else []
        self.line_counter.update(width, height, track_ids, centers)

        endpoints = self.line_counter.line_endpoints(width, height)
        if endpoints is not None:
            cv2.line(annotated, endpoints[0], endpoints[1], (0, 255, 255), 2)
            cv2.putText(
                annotated,
                f"Count: {self.line_counter.count}",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )
        else:
            cv2.putText(
                annotated,
                "Calibrating counting line...",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 200, 255),
                2,
            )

        stats = {
            "current_detections": len(confidences),
            "confidence_avg": (sum(confidences) / len(confidences)) if confidences else 0.0,
            "active_track_ids": track_ids,
            "line_crossing_count": self.line_counter.count,
            "calibrating": self.line_counter.is_calibrating,
        }
        return annotated, stats

    def reset_tracker(self):
        """Clears ByteTrack's internal state and line-crossing counts
        between independent streams (a new video upload, a new webcam
        session).

        Ultralytics' on_predict_start callback only (re)initializes
        predictor.trackers when the attribute is *absent* (it checks
        hasattr(predictor, "trackers")). Setting it to None still leaves
        the attribute present, so init is skipped and the next track() call
        crashes on `predictor.trackers[0]`. Deleting the attribute is the
        correct reset.
        """
        predictor = getattr(self.model, "predictor", None)
        if predictor is not None and hasattr(predictor, "trackers"):
            del predictor.trackers
        self.line_counter.reset()
