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

# Without this, two runs of the same video on the same GPU can produce
# different bag counts: CUDA's default kernels don't guarantee a fixed
# floating-point reduction order, so detection confidences/box coordinates
# jitter by tiny amounts run-to-run. On ordinary content that's invisible,
# but on borderline footage (blurry, marginal confidences, closely-spaced
# bags) that jitter is enough to flip which side of a threshold a detection
# lands on, or how ByteTrack resolves a close ID match — observed directly
# as bag_count varying run-to-run on identical code and the same input file.
# Forcing determinism trades a little raw speed for the same input always
# producing the same output, which matters far more once real per-camera
# thresholds get tuned against this system's results.
torch.manual_seed(0)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(0)
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False


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


# Confidence floor passed to the tracker in track_frame(), not the user-facing
# confidence_threshold, so ByteTrack's low-confidence track-association logic
# gets more boxes to work with than the display threshold alone would allow
# through. See track_frame()'s docstring for why this must be decoupled from
# the display/counting threshold.
#
# Deliberately NOT bytetrack.yaml's own track_low_thresh (0.10): tried that
# first and it flooded noisy/grainy footage (night IR, heavy compression)
# with so many marginal candidate boxes that YOLO's own NMS occasionally blew
# past its internal time budget on a single frame ("NMS time limit 2.050s
# exceeded"), stalling that frame for seconds. bytetrack.yaml's own
# new_track_thresh/track_high_thresh (0.25) is the threshold that actually
# matters for whether a box can start or extend a track, so there's no
# benefit to going lower than that at the YOLO stage — only NMS cost.
_TRACKER_MIN_CONF = 0.20


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
        # Cache of the pixel-space inclusion mask built from self._roi, keyed
        # by the (height, width) it was built for — see _roi_mask_for(). The
        # polygon doesn't change frame-to-frame, so this is rebuilt only when
        # the ROI or frame resolution actually changes.
        self._roi_mask: np.ndarray | None = None
        self._roi_mask_shape: tuple[int, int] | None = None

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
        self._roi_mask = None
        self._roi_mask_shape = None
        if self._roi is None:
            # Falling back to full-frame detection — drop the ROI-derived
            # counting line so it re-calibrates from observed motion instead.
            self.line_counter.reset()
        else:
            self._roi_dirty = True

    def _roi_mask_for(self, height: int, width: int) -> np.ndarray:
        """Binary inclusion mask (uint8, 0 or 255) built from self._roi,
        cached per (height, width) since the polygon doesn't change
        frame-to-frame.

        This used to be multiplied directly against pixel values to fade
        out everything outside the ROI *before* detection ran. That fed a
        degraded, partially-blacked-out image to the model right at the
        boundary — exactly where bags actually cross — which was measured
        to both hurt detection confidence and, worse, fragment ByteTrack
        continuity badly enough that the line-crossing calibration (which
        needs the *same* track seen on two directly consecutive frames,
        see line_counter.py) sometimes never accumulated a single usable
        sample for an entire video. Detection now always runs on the full,
        untouched frame; this mask is used only afterwards, in
        _filter_by_roi(), to drop detections centered outside the drawn
        area — so a real bag's pixels are never degraded, only the
        decision of whether to keep/count it.
        """
        if self._roi_mask_shape != (height, width):
            polygon = np.array(
                [(x * width, y * height) for x, y in self._roi],
                dtype=np.int32,
            )
            mask = np.zeros((height, width), dtype=np.uint8)
            cv2.fillPoly(mask, [polygon], 255)
            # Same small grace margin as before: a bag whose center lands
            # just outside the drawn line (imprecise hand-drawn polygon)
            # still counts, rather than a hard cutoff exactly on the line.
            margin = max(8, int(min(width, height) * 0.02))
            kernel = np.ones((margin, margin), dtype=np.uint8)
            self._roi_mask = cv2.dilate(mask, kernel)
            self._roi_mask_shape = (height, width)
        return self._roi_mask

    def _filter_by_roi(self, result, height: int, width: int):
        """Keeps only the boxes in `result` whose center falls inside the
        ROI (see _roi_mask_for). No-op (returns `result` unchanged) when no
        ROI is set."""
        if not self._roi or result.boxes is None or len(result.boxes) == 0:
            return result
        mask = self._roi_mask_for(height, width)
        centers = result.boxes.xywh[:, :2].cpu().numpy()
        xs = np.clip(centers[:, 0].astype(np.int32), 0, width - 1)
        ys = np.clip(centers[:, 1].astype(np.int32), 0, height - 1)
        keep = mask[ys, xs] > 0
        return result[keep]

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
        height, width = image_bgr.shape[:2]
        result = self._filter_by_roi(result, height, width)
        annotated = result.plot()
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

        The YOLO call below always asks for boxes down to _TRACKER_MIN_CONF,
        not self.confidence_threshold: bytetrack.yaml's own track_low_thresh
        (0.10) exists specifically so a track survives a temporary confidence
        dip (motion blur, poor lighting) via low-confidence association
        instead of high-confidence-only creation, but that only works if
        ByteTrack actually gets to see those low-confidence boxes. Passing
        self.confidence_threshold as `conf` here would filter them out before
        ByteTrack ever runs, silently defeating that recovery path — a bag
        that blurs for a couple of frames would lose its track and come back
        as a new ID, which (since counting requires min_hit_streak frames on
        one ID) frequently means it's never counted at all. self.confidence_
        threshold is instead applied afterwards, only to what gets drawn and
        reported — the line counter still sees every tracked position, high-
        confidence or not, so a crossing during a brief confidence dip is not
        lost.
        """
        original = frame_bgr
        results = self.model.track(
            source=original,
            conf=_TRACKER_MIN_CONF,
            iou=self.iou_threshold,
            imgsz=self.image_size,
            device=self.device,
            persist=True,
            tracker=self.tracker_config,
            verbose=False,
        )
        result = results[0]
        height, width = original.shape[:2]

        # Drop anything outside the drawn area *after* detection/tracking,
        # not before — running on the full frame keeps ByteTrack's track
        # continuity intact (see _roi_mask_for()'s docstring for why masking
        # pixels beforehand broke calibration on real footage).
        result = self._filter_by_roi(result, height, width)

        all_track_ids = (
            [int(t) for t in result.boxes.id.tolist()]
            if result.boxes is not None and result.boxes.id is not None
            else []
        )
        all_centers = result.boxes.xywh[:, :2].tolist() if (all_track_ids and result.boxes is not None) else []

        if self._roi_dirty and self._roi is not None:
            pixel_roi = [(x * width, y * height) for x, y in self._roi]
            self.line_counter.set_roi_bounds(pixel_roi)
            self._roi_dirty = False

        # Every tracked position feeds the line counter, regardless of this
        # frame's confidence — see the docstring above.
        self.line_counter.update(width, height, all_track_ids, all_centers)

        if result.boxes is not None and len(result.boxes) > 0:
            display_result = result[result.boxes.conf >= self.confidence_threshold]
        else:
            display_result = result
        annotated = display_result.plot()
        confidences = (
            [float(c) for c in display_result.boxes.conf.tolist()] if display_result.boxes is not None else []
        )

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
            "active_track_ids": all_track_ids,
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
