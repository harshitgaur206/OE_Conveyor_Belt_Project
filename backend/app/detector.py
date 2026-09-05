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
        self._default_confidence = settings.confidence_threshold
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
        self._roi: list[tuple[float, float]] | None = None
        # Set whenever the ROI changes; consumed by track_frame() the next
        # time it runs to (re)derive the counting line from the new ROI's
        # geometry — deferred because normalized ROI points need the actual
        # frame's pixel dimensions to convert, and those aren't known here.
        self._roi_dirty = False

    @property
    def has_roi(self) -> bool:
        return self._roi is not None

    def set_confidence(self, value: float | None) -> None:
        """Overrides the detection confidence threshold for this detector
        instance. Pass None to reset to the deployment-wide default from
        settings. Each CementBagDetector is either the single shared
        image/video detector or one dedicated to a single camera (see
        camera_manager.py), so this never leaks between unrelated sources.
        """
        self.confidence_threshold = value if value is not None else self._default_confidence

    def set_roi(self, points: list[tuple[float, float]] | None) -> None:
        """Sets the region of interest as a polygon of normalized (0-1)
        coordinates, so it stays valid across frame sizes that differ from
        whatever preview frame the user drew it against (e.g. an RTSP stream
        whose negotiated resolution differs slightly from the still preview).
        Pass None to clear it and go back to detecting on the full frame.
        """
        new_roi = points if points else None
        if new_roi == self._roi:
            return
        self._roi = new_roi
        if self._roi is None:
            # Falling back to full-frame detection — drop the ROI-derived
            # counting line so it re-calibrates from observed motion instead.
            self.line_counter.reset()
        else:
            self._roi_dirty = True

    def _apply_roi(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Fades out everything outside the ROI polygon before inference, so
        YOLO is only really looking at the marked area (and can't
        spuriously detect in the rest of the frame). Cheaper alternatives
        like cropping to the bounding box would still let a non-rectangular
        ROI leak in its corners.

        The mask is dilated and blurred rather than applied as a hard
        binary cutoff: a bag straddling a sharp boundary gets abruptly
        clipped as it moves, and that changing silhouette shape from frame
        to frame is enough to push its confidence back and forth across
        the threshold — visible as boxes flickering on and off right at
        the ROI edge. Dilating gives real content just outside the drawn
        line a little grace, and blurring turns the cutoff into a soft
        fade the model reads more like ordinary vignetting than an
        artifact, while area well outside the ROI is still ~fully zeroed.
        """
        if not self._roi:
            return frame_bgr
        height, width = frame_bgr.shape[:2]
        polygon = np.array(
            [(x * width, y * height) for x, y in self._roi],
            dtype=np.int32,
        )
        mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(mask, [polygon], 255)
        margin = max(8, int(min(width, height) * 0.02))
        kernel = np.ones((margin, margin), dtype=np.uint8)
        mask = cv2.dilate(mask, kernel)
        mask = cv2.GaussianBlur(mask, (margin * 2 + 1, margin * 2 + 1), 0)
        mask_3ch = cv2.merge([mask, mask, mask]).astype(np.float32) / 255.0
        return (frame_bgr.astype(np.float32) * mask_3ch).astype(np.uint8)

    def detect_image(self, image_bgr: np.ndarray) -> DetectionResult:
        start = time.perf_counter()
        masked = self._apply_roi(image_bgr)
        results = self.model.predict(
            source=masked,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            imgsz=self.image_size,
            device=self.device,
            verbose=False,
        )
        latency_ms = (time.perf_counter() - start) * 1000

        result = results[0]
        # Draw over the original (unmasked) frame rather than `masked` so an
        # ROI doesn't turn the rest of the image black for the viewer —
        # detection is still restricted to the ROI, only the display isn't.
        annotated = result.plot(img=image_bgr if self._roi else None)
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
        each track once when it crosses a counting line, auto-calibrated
        from a few frames of observed travel direction — real motion, not
        guessed from the ROI polygon's shape — so this works on any belt
        orientation/camera placement without per-site tuning. When an ROI
        is set, the drawn line is additionally confined to display within
        its bounds (see line_counter.set_roi_bounds); that's cosmetic only
        and never affects which direction counts as a crossing.
        """
        original = frame_bgr
        masked = self._apply_roi(frame_bgr)
        results = self.model.track(
            source=masked,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            imgsz=self.image_size,
            device=self.device,
            persist=True,
            tracker=self.tracker_config,
            verbose=False,
        )
        result = results[0]
        annotated = result.plot(img=original if self._roi else None)
        confidences = [float(c) for c in result.boxes.conf.tolist()] if result.boxes is not None else []
        track_ids = (
            [int(t) for t in result.boxes.id.tolist()]
            if result.boxes is not None and result.boxes.id is not None
            else []
        )

        height, width = original.shape[:2]

        if self._roi_dirty and self._roi is not None:
            pixel_roi = [(x * width, y * height) for x, y in self._roi]
            self.line_counter.set_roi_bounds(pixel_roi)
            self._roi_dirty = False

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
        # reset() above also clears the ROI-derived line lock; if an ROI is
        # still set, re-derive it on the next track_frame() call instead of
        # falling back to a fresh motion-calibration warm-up.
        if self._roi is not None:
            self._roi_dirty = True
