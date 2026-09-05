"""Diagnostic probing for a live source (local webcam device or RTSP stream).

The persistent multi-camera capture + MJPEG streaming loop lives in
CameraSession (camera_manager.py) — one per camera, each with its own
detector/tracker. This module keeps only the lightweight "is this source
reachable at all" check used before committing to adding a camera.
"""

import time

import cv2

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
