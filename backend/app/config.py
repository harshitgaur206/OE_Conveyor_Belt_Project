"""Runtime configuration, loaded from environment variables."""

import os
from dataclasses import dataclass
from pathlib import Path

# Must be set before any cv2.VideoCapture(..., cv2.CAP_FFMPEG) call anywhere
# in the app (camera_manager.py, streaming.py) — OpenCV's FFmpeg backend
# reads this env var when a capture is opened, not at import time. This
# module is imported first by everything else (via get_settings()), so
# setting it here guarantees it's in place in time.
#
# Only quiets FFmpeg's decoder log spam ("mmco: unref short failure", "co
# located POCs unavailable", etc. — harmless concealment of corrupted frames
# from packet loss/stream discontinuities, not a crash). Deliberately NOT
# forcing rtsp_transport=tcp here: OPENCV_FFMPEG_CAPTURE_OPTIONS is a global
# setting applied to every cv2.VideoCapture call regardless of source type,
# so it also gets attached to plain local video files and UDP-only cameras —
# an unrecognized/unsupported option there can make the capture fail to open
# at all. If a specific deployment's RTSP source needs TCP, set that
# per-source via the rtsp:// URL's own client (most cameras support
# `?transport=tcp` or a device-side config setting) rather than globally here.
os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")  # AV_LOG_QUIET — this reads a raw int, not a symbolic name

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
    # NMS suppresses a lower-confidence box only when its IoU with a
    # higher-confidence box EXCEEDS this threshold — so a higher value is
    # actually more permissive (fewer boxes get merged), not stricter.
    # Reverted to 0.45 after 0.30 was tested with deterministic inference
    # (see detector.py's torch determinism setup) and produced a worse,
    # reproducible result on real target footage than 0.45 did — the
    # duplicate-overlapping-box problem 0.30 targeted is real (see git
    # history), but tightening NMS this far apparently costs more real
    # detections on this content than it recovers. Back to the default
    # until validated with real labeled footage per CLAUDE.md Section 28.
    iou_threshold: float = float(os.getenv("IOU_THRESHOLD", "0.45"))
    image_size: int = int(os.getenv("IMAGE_SIZE", "640"))
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
    # Lowered from the original 3: on fast/blurry/grainy footage, ByteTrack
    # frequently reassigns a bag to a new track ID every couple of frames
    # (occlusion, motion blur, confidence dips) — see detector.py's
    # track_frame docstring. Requiring 3 consecutive hits on one ID before a
    # crossing counts is rarely satisfied when IDs live that briefly, so real
    # crossings were being silently dropped (observed: a video with 14 real
    # bags counting only 1). 1 still requires two real observations of the
    # same ID straddling the line (not a single-frame blip), just not three.
    # Trades a small risk of double-counting a bag whose ID happens to churn
    # exactly at the line for far fewer missed bags — for a count meant to
    # reflect real throughput, undercounting is the worse failure mode.
    min_hit_streak: int = int(os.getenv("MIN_HIT_STREAK", "1"))
    # Each concurrent camera loads its own YOLO model instance (see
    # camera_manager.py — tracker state can't safely be shared across
    # independent streams), so this is really a GPU/CPU memory ceiling, not
    # an arbitrary product limit. Tune per deployment hardware.
    max_concurrent_cameras: int = int(os.getenv("MAX_CONCURRENT_CAMERAS", "4"))
    history_db_path: str = os.getenv("HISTORY_DB_PATH", str(_BACKEND_DIR / "data" / "history.db"))
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
