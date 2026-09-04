"""Batch processing for an uploaded video file: run tracking frame-by-frame,
write an annotated copy to disk, and return summary stats.

Bag counting uses the line-crossing logic in CementBagDetector.track_frame
(a fixed horizontal line instead of the original CLI's interactive
mouse-selected ROI+line, since there's no terminal to click in on a server) —
see the docstring there for why raw distinct-track-ID counting overcounts.

Output is encoded with ffmpeg/libx264 rather than cv2.VideoWriter: OpenCV's
pip wheel needs the (unbundled) Cisco OpenH264 DLL to write real H.264 and
silently falls back to MPEG-4 Part 2 ("mp4v"), which browsers can't play —
the file loads but shows 0:00 and never starts. imageio-ffmpeg bundles a
static ffmpeg binary with libx264, so frames are piped to it directly.
"""

import subprocess
import time
import uuid
from pathlib import Path

import cv2
from imageio_ffmpeg import get_ffmpeg_exe

from app.config import get_settings
from app.detector import CementBagDetector


def _open_ffmpeg_writer(output_path: Path, fps: float, width: int, height: int) -> subprocess.Popen:
    command = [
        get_ffmpeg_exe(),
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",
        "-an",
        "-vcodec", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(output_path),
    ]
    return subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def process_video(detector: CementBagDetector, input_path: Path) -> dict:
    settings = get_settings()
    media_dir = Path(settings.media_dir)
    media_dir.mkdir(parents=True, exist_ok=True)

    output_name = f"{uuid.uuid4().hex}.mp4"
    output_path = media_dir / output_name

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open uploaded video: {input_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = _open_ffmpeg_writer(output_path, fps, width, height)

    detector.reset_tracker()
    all_confidences: list[float] = []
    frame_count = 0
    bag_count = 0
    start = time.perf_counter()

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            frame_count += 1
            annotated, stats = detector.track_frame(frame)
            bag_count = stats["line_crossing_count"]
            if stats["current_detections"]:
                all_confidences.append(stats["confidence_avg"])
            if annotated.shape[1::-1] != (width, height):
                annotated = cv2.resize(annotated, (width, height))
            writer.stdin.write(annotated.tobytes())
    finally:
        capture.release()
        if writer.stdin:
            writer.stdin.close()
        writer.wait()

    latency_ms = (time.perf_counter() - start) * 1000

    return {
        "output_video_path": str(output_path),
        "output_video_name": output_name,
        "bag_count": bag_count,
        "frame_count": frame_count,
        "latency_ms": latency_ms,
        "confidence_avg": (sum(all_confidences) / len(all_confidences)) if all_confidences else 0.0,
    }
