"""Runtime configuration, loaded from environment variables."""

import os
from dataclasses import dataclass
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    model_path: str = os.getenv("MODEL_PATH", "models/best.pt")
    # Upstream's own default (0.10) is tuned for their specific grainy
    # conveyor footage and is very permissive — pointed at anything outside
    # that training distribution (a person, a random room via webcam) it
    # readily produces spurious detections, since this is a small
    # custom-trained bag detector with no real "not a bag" concept, not a
    # general-purpose classifier. 0.45 is a more conservative default for
    # general use; override per-deployment once validated against real
    # belt footage (CLAUDE.md Section 28 — don't invent thresholds without
    # validation data, so treat this as a starting point, not a final value).
    confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.45"))
    iou_threshold: float = float(os.getenv("IOU_THRESHOLD", "0.45"))
    image_size: int = int(os.getenv("IMAGE_SIZE", "640"))
    webcam_index: int = int(os.getenv("WEBCAM_INDEX", "0"))
    webcam_frame_skip: int = int(os.getenv("WEBCAM_FRAME_SKIP", "1"))
    media_dir: str = os.getenv("MEDIA_DIR", "media")
    tracker_config_path: str = os.getenv("TRACKER_CONFIG_PATH", str(_BACKEND_DIR / "bytetrack.yaml"))
    device: str = os.getenv("DEVICE", "auto")  # "auto" | "cpu" | "cuda" | "cuda:0" ...
    # A track is counted once when it crosses the counting line, after being
    # seen for at least min_hit_streak frames — mirrors the upstream CLI's
    # ROI+line-crossing logic instead of tallying every distinct track ID
    # (which overcounts badly on fragmented/re-assigned tracks).
    #
    # "auto" (default) doesn't assume any fixed belt orientation: it watches
    # the actual net movement of tracked bags for calibration_min_samples
    # observations, derives the dominant travel direction from that, and
    # places the counting line perpendicular to it through the frame center
    # — works for a belt running left-right, top-bottom, or at an angle,
    # without per-camera tuning. "horizontal"/"vertical" skip calibration
    # and fix the line's orientation immediately, positioned at
    # counting_line_fraction of the frame (0.5 = middle); use these only for
    # an installation where you already know the belt direction and want to
    # count from frame 1 instead of after the calibration window.
    counting_line_orientation: str = os.getenv("COUNTING_LINE_ORIENTATION", "auto")
    counting_line_fraction: float = float(os.getenv("COUNTING_LINE_FRACTION", "0.5"))
    calibration_min_samples: int = int(os.getenv("CALIBRATION_MIN_SAMPLES", "20"))
    min_hit_streak: int = int(os.getenv("MIN_HIT_STREAK", "3"))
    cors_origins: list[str] = None  # set in get_settings()

    def __post_init__(self):
        if self.cors_origins is None:
            origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
            object.__setattr__(self, "cors_origins", [o.strip() for o in origins.split(",")])


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
