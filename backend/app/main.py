"""FastAPI service wrapping the Cement_Bag_Detection_System YOLO model.

PROTOTYPE — standalone spike, not the production Phase 6 Material Detection
service described in CLAUDE.md. Before production: swap the naive video/webcam
handling for event-triggered inference, add auth, move media to object
storage, and attach model/dataset version metadata to every detection.
"""

import asyncio
import base64
import logging
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import cv2
import numpy as np

from app.config import get_settings
from app.detector import CementBagDetector
from app.streaming import LiveStreamManager, probe_source
from app.video_processor import process_video

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cement_bag_api")

settings = get_settings()
app = FastAPI(title="Cement Bag Detection API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector: CementBagDetector | None = None
stream_manager: LiveStreamManager | None = None
inference_lock = asyncio.Lock()

# The detector holds one shared, non-reentrant tracker (see detector.py), so
# only one live session — the backend-side webcam/RTSP stream, or a browser
# pushing its own camera over /ws/detect — can run at a time. Without this,
# two simultaneous sessions would interleave frames into the same ByteTrack
# state and silently produce a nonsensical bag count for both.
#
# Plain sync functions, not async-locked: uvicorn/Starlette run this on a
# single event-loop thread, so a bare bool check-and-set can't be interleaved
# by another coroutine (there's no `await` in between to yield control). That
# also makes release() safe to call from a `finally` under task cancellation
# — an `async with a_lock:` here would instead leave a cancellation window
# where the flag could get stuck "active" forever if the task were cancelled
# mid-acquire.
_live_session_active = False


def _try_acquire_live_session() -> bool:
    global _live_session_active
    if _live_session_active:
        return False
    _live_session_active = True
    return True


def _release_live_session() -> None:
    global _live_session_active
    _live_session_active = False


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Registering a handler for the base Exception keeps this inside
    # Starlette's ExceptionMiddleware, so CORSMiddleware still sees a normal
    # response and attaches CORS headers to it. Without this, an unhandled
    # exception falls through to ServerErrorMiddleware's fallback 500, which
    # has no CORS headers — the browser then blocks it as a CORS violation
    # and the frontend sees a generic network error indistinguishable from
    # the backend being down entirely.
    logger.exception("Unhandled error while processing %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("startup")
def load_model():
    global detector, stream_manager
    try:
        detector = CementBagDetector()
        stream_manager = LiveStreamManager(detector)
        logger.info("Model loaded from %s", settings.model_path)
    except Exception:
        logger.exception("Failed to load model at startup")
        detector = None


@app.on_event("shutdown")
def release_resources():
    if stream_manager is not None:
        stream_manager.stop()


def require_detector() -> CementBagDetector:
    if detector is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return detector


@app.get("/health")
def health():
    return {
        "status": "ok" if detector is not None else "degraded",
        "model_loaded": detector is not None,
        "model_path": settings.model_path,
    }


@app.post("/detect/image")
async def detect_image(file: UploadFile = File(...)):
    det = require_detector()
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    raw = await file.read()
    image_array = np.frombuffer(raw, dtype=np.uint8)
    image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    async with inference_lock:
        result = await asyncio.to_thread(det.detect_image, image_bgr)

    return {
        "annotated_image_base64": result.annotated_image_base64,
        "bag_count": result.bag_count,
        "latency": round(result.latency_ms, 2),
        "confidence_avg": round(result.confidence_avg, 4),
    }


@app.post("/detect/video")
async def detect_video(file: UploadFile = File(...)):
    det = require_detector()
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a video")

    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "upload.mp4").suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        async with inference_lock:
            summary = await asyncio.to_thread(process_video, det, tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "annotated_video_url": f"/media/{summary['output_video_name']}",
        "bag_count": summary["bag_count"],
        "frame_count": summary["frame_count"],
        "latency": round(summary["latency_ms"], 2),
        "confidence_avg": round(summary["confidence_avg"], 4),
    }


@app.get("/media/{filename}")
def get_media(filename: str):
    path = Path(settings.media_dir) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="video/mp4")


@app.get("/stream/webcam")
async def stream_webcam(rtsp_url: str | None = None):
    """Streams a camera reachable from the *backend host* — its own local
    webcam by default, or an RTSP camera/NVR when ?rtsp_url= is passed. This
    is the right tool for a real network camera (which is only reachable by
    IP from wherever the backend runs), but it is NOT the viewer's own
    device camera — use /ws/detect for that."""
    if stream_manager is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    if not _try_acquire_live_session():
        raise HTTPException(status_code=409, detail="Another live session is already active")

    async def guarded_frames():
        # frame_generator() is a plain sync generator — each next() does a
        # blocking cv2 read + model inference. Stepping it with a bare
        # `for chunk in ...` would run entirely inside this coroutine with no
        # `await` in the loop body, monopolizing the single event-loop
        # thread for the whole stream's duration (every other request,
        # including /health, would stall until the stream ends). Stepping it
        # via asyncio.to_thread instead offloads each blocking frame to a
        # worker thread and hands control back to the event loop in between.
        iterator = stream_manager.frame_generator(source=rtsp_url)
        sentinel = object()
        try:
            while True:
                chunk = await asyncio.to_thread(next, iterator, sentinel)
                if chunk is sentinel:
                    break
                yield chunk
        finally:
            _release_live_session()

    return StreamingResponse(
        guarded_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/stream/webcam/stats")
def stream_webcam_stats():
    if stream_manager is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return stream_manager.get_stats()


@app.post("/stream/webcam/stop")
def stop_webcam():
    if stream_manager is not None:
        stream_manager.stop()
    return {"stopped": True}


@app.get("/stream/check")
def stream_check(source: str):
    """Diagnostic: tries to open `source` (an RTSP URL, or a bare integer
    for a local device index) and read one frame, without starting a
    persistent stream. Use this to verify an RTSP URL is reachable before
    pointing the dashboard's live view at it."""
    resolved: int | str = int(source) if source.isdigit() else source
    return probe_source(resolved)


@app.websocket("/ws/detect")
async def websocket_detect(websocket: WebSocket):
    """Browser-camera counterpart to /stream/webcam.

    /stream/webcam opens a camera on the machine running this backend,
    which is correct for a real network/RTSP camera but wrong for "use my
    own device's camera" — the browser can't hand a live MediaStream to a
    plain GET endpoint. Here the browser instead captures its own
    getUserMedia feed to a canvas, pushes each frame as a binary JPEG blob
    over this socket, and gets back annotated JPEG + stats as JSON — no
    camera is ever opened on the server.
    """
    det = detector
    await websocket.accept()

    if det is None:
        await websocket.close(code=1013, reason="Model is not loaded")
        return
    if not _try_acquire_live_session():
        await websocket.close(code=1013, reason="Another live session is already active")
        return

    async with inference_lock:
        await asyncio.to_thread(det.reset_tracker)

    try:
        while True:
            data = await websocket.receive_bytes()
            image_array = np.frombuffer(data, dtype=np.uint8)
            frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            start = time.perf_counter()
            async with inference_lock:
                annotated, stats = await asyncio.to_thread(det.track_frame, frame)
            elapsed_ms = (time.perf_counter() - start) * 1000

            ok, buffer = cv2.imencode(".jpg", annotated)
            if not ok:
                continue

            await websocket.send_json(
                {
                    "annotated_image_base64": base64.b64encode(buffer).decode("utf-8"),
                    "bag_count": stats["line_crossing_count"],
                    "confidence_avg": round(stats["confidence_avg"], 4),
                    "latency_ms": round(elapsed_ms, 2),
                    "calibrating": stats["calibrating"],
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        # Not resetting the tracker here on purpose: release must be able to
        # complete even if this task is being cancelled (e.g. server
        # shutdown, an abrupt client disconnect racing the framework's own
        # teardown), and reset_tracker() involves an extra await that would
        # add another window for that to be interrupted. The next session's
        # connect handler already resets before it reads anything, so a
        # stale tracker between sessions is harmless.
        _release_live_session()
