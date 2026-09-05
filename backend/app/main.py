"""FastAPI service wrapping the Cement_Bag_Detection_System YOLO model.

PROTOTYPE — standalone spike, not the production Phase 6 Material Detection
service described in CLAUDE.md. Before production: swap the naive video/webcam
handling for event-triggered inference, add auth, move media to object
storage, and attach model/dataset version metadata to every detection.
"""

import asyncio
import base64
import json
import logging
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import cv2
import numpy as np
from pydantic import BaseModel

from app import history
from app.camera_manager import CameraManager, CameraSession
from app.config import get_settings
from app.detector import CementBagDetector
from app.streaming import probe_source
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
camera_manager: CameraManager | None = None
inference_lock = asyncio.Lock()

# The shared `detector` above holds one non-reentrant tracker (see
# detector.py), used by /detect/video and /ws/detect. Only one browser-camera
# session may run at a time for this reason — two simultaneous sessions would
# interleave frames into the same ByteTrack state and silently produce a
# nonsensical bag count for both. RTSP/network cameras don't share this
# constraint: each gets its own CameraSession with its own detector instance
# (see camera_manager.py), so multiple of those can run concurrently.
#
# Plain sync functions, not async-locked: uvicorn/Starlette run this on a
# single event-loop thread, so a bare bool check-and-set can't be interleaved
# by another coroutine (there's no `await` in between to yield control). That
# also makes release() safe to call from a `finally` under task cancellation
# — an `async with a_lock:` here would instead leave a cancellation window
# where the flag could get stuck "active" forever if the task were cancelled
# mid-acquire.
_browser_session_active = False


def _try_acquire_browser_session() -> bool:
    global _browser_session_active
    if _browser_session_active:
        return False
    _browser_session_active = True
    return True


def _release_browser_session() -> None:
    global _browser_session_active
    _browser_session_active = False


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
    global detector, camera_manager
    history.init_db()
    camera_manager = CameraManager(max_concurrent=settings.max_concurrent_cameras)
    try:
        detector = CementBagDetector()
        logger.info("Model loaded from %s", settings.model_path)
    except Exception:
        logger.exception("Failed to load model at startup")
        detector = None


@app.on_event("shutdown")
def release_resources():
    if camera_manager is not None:
        camera_manager.stop_all()


def require_detector() -> CementBagDetector:
    if detector is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return detector


def require_camera_manager() -> CameraManager:
    if camera_manager is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return camera_manager


def require_camera(camera_id: str) -> CameraSession:
    session = require_camera_manager().get(camera_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    return session


class CreateCameraRequest(BaseModel):
    name: str
    rtsp_url: str
    confidence: float | None = None


class SetROIRequest(BaseModel):
    points: list[tuple[float, float]]


class SetConfidenceRequest(BaseModel):
    value: float | None = None


def _parse_roi_points(raw: str | None) -> list[tuple[float, float]] | None:
    """Parses the `roi_points` form field: a JSON array of [x, y] pairs
    normalized to 0-1, or None/empty when no ROI was drawn."""
    if not raw:
        return None
    try:
        points = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="roi_points must be valid JSON")
    if not isinstance(points, list) or len(points) < 3:
        raise HTTPException(status_code=400, detail="roi_points must be a list of at least 3 [x, y] pairs")
    return [(float(x), float(y)) for x, y in points]


def _validate_confidence(value: float | None) -> float | None:
    if value is None:
        return None
    if not 0.01 <= value <= 1.0:
        raise HTTPException(status_code=400, detail="confidence must be between 0.01 and 1.0")
    return value


def _parse_confidence_form(raw: str | None) -> float | None:
    """Parses the `confidence` form field on /detect/image and /detect/video."""
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="confidence must be a number")
    return _validate_confidence(value)


def _first_frame_base64(image_bgr: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image_bgr)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode preview frame")
    return base64.b64encode(buffer).decode("utf-8")


@app.post("/roi/preview")
async def roi_preview(file: UploadFile = File(...)):
    """Returns the first frame of an uploaded image or video as base64, with
    no detection run — the frontend draws the ROI polygon against this frame
    before the real /detect/image or /detect/video call."""
    content_type = file.content_type or ""
    raw = await file.read()

    if content_type.startswith("image/"):
        image_array = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode image")
        return {"frame_base64": _first_frame_base64(frame)}

    if content_type.startswith("video/"):
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "upload.mp4").suffix) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            capture = cv2.VideoCapture(str(tmp_path))
            ok, frame = capture.read()
            capture.release()
            if not ok or frame is None:
                raise HTTPException(status_code=400, detail="Could not read a frame from the uploaded video")
            return {"frame_base64": _first_frame_base64(frame)}
        finally:
            tmp_path.unlink(missing_ok=True)

    raise HTTPException(status_code=400, detail="Uploaded file must be an image or video")


@app.get("/health")
def health():
    return {
        "status": "ok" if detector is not None else "degraded",
        "model_loaded": detector is not None,
        "model_path": settings.model_path,
    }


@app.post("/detect/image")
async def detect_image(
    file: UploadFile = File(...),
    roi_points: str | None = Form(None),
    confidence: str | None = Form(None),
):
    det = require_detector()
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    raw = await file.read()
    image_array = np.frombuffer(raw, dtype=np.uint8)
    image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    roi = _parse_roi_points(roi_points)
    conf = _parse_confidence_form(confidence)
    request_time = time.time()
    async with inference_lock:
        # /detect/image shares this one process-wide detector across
        # unrelated requests, so the ROI/confidence set for this request
        # must not leak into the next caller's — always restore afterwards.
        det.set_roi(roi)
        det.set_confidence(conf)
        try:
            result = await asyncio.to_thread(det.detect_image, image_bgr)
        finally:
            det.set_roi(None)
            det.set_confidence(None)

    history.insert_record(
        source_type="image",
        source_name=file.filename or "upload",
        started_at=request_time,
        ended_at=time.time(),
        bag_count=result.bag_count,
        confidence_avg=result.confidence_avg,
        frame_count=1,
        roi_used=roi is not None,
        annotated_media_path=None,
    )

    return {
        "annotated_image_base64": result.annotated_image_base64,
        "bag_count": result.bag_count,
        "latency": round(result.latency_ms, 2),
        "confidence_avg": round(result.confidence_avg, 4),
    }


@app.post("/detect/video")
async def detect_video(
    file: UploadFile = File(...),
    roi_points: str | None = Form(None),
    confidence: str | None = Form(None),
):
    det = require_detector()
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a video")

    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "upload.mp4").suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    roi = _parse_roi_points(roi_points)
    conf = _parse_confidence_form(confidence)
    request_time = time.time()
    try:
        async with inference_lock:
            det.set_roi(roi)
            det.set_confidence(conf)
            try:
                summary = await asyncio.to_thread(process_video, det, tmp_path)
            finally:
                det.set_roi(None)
                det.set_confidence(None)
    finally:
        tmp_path.unlink(missing_ok=True)

    history.insert_record(
        source_type="video",
        source_name=file.filename or "upload",
        started_at=request_time,
        ended_at=time.time(),
        bag_count=summary["bag_count"],
        confidence_avg=summary["confidence_avg"],
        frame_count=summary["frame_count"],
        roi_used=roi is not None,
        annotated_media_path=summary["output_video_name"],
    )

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


@app.post("/cameras")
def create_camera(body: CreateCameraRequest):
    """Registers a new RTSP/network camera session. Each camera gets its own
    detector + tracker (see camera_manager.py), so multiple of these can run
    concurrently and be viewed side by side in a grid — unlike the single
    shared-detector browser-camera path (/ws/detect)."""
    manager = require_camera_manager()
    confidence = _validate_confidence(body.confidence)
    try:
        session = manager.create(body.name, body.rtsp_url)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if confidence is not None:
        session.detector.set_confidence(confidence)
    return {
        "id": session.id,
        "name": session.name,
        "rtsp_url": session.rtsp_url,
        "confidence": session.detector.confidence_threshold,
    }


@app.get("/cameras")
def list_cameras():
    manager = require_camera_manager()
    return [
        {
            "id": s.id,
            "name": s.name,
            "rtsp_url": s.rtsp_url,
            "confidence": s.detector.confidence_threshold,
            **s.get_stats(),
        }
        for s in manager.list()
    ]


@app.get("/cameras/{camera_id}/preview")
def camera_preview(camera_id: str):
    """Grabs one frame from the camera without starting the persistent
    stream/tracker — the frontend draws the ROI polygon against this."""
    session = require_camera(camera_id)
    try:
        frame = session.preview_frame()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"frame_base64": _first_frame_base64(frame)}


@app.post("/cameras/{camera_id}/roi")
def set_camera_roi(camera_id: str, body: SetROIRequest):
    session = require_camera(camera_id)
    if len(body.points) < 3:
        raise HTTPException(status_code=400, detail="points must have at least 3 [x, y] pairs")
    session.set_roi(body.points)
    return {"ok": True}


@app.post("/cameras/{camera_id}/confidence")
def set_camera_confidence(camera_id: str, body: SetConfidenceRequest):
    """Adjusts this camera's own confidence threshold — independent of every
    other camera's, and of the shared image/video detector's — since each
    camera has its own CementBagDetector instance (see camera_manager.py).
    Takes effect on the next frame; no stream restart needed."""
    session = require_camera(camera_id)
    value = _validate_confidence(body.value)
    session.detector.set_confidence(value)
    return {"confidence": session.detector.confidence_threshold}


@app.get("/cameras/{camera_id}/stream")
async def camera_stream(camera_id: str):
    session = require_camera(camera_id)
    if not session.try_acquire_stream():
        raise HTTPException(status_code=409, detail="This camera already has an active stream")

    async def guarded_frames():
        # frame_generator() is a plain sync generator — each next() does a
        # blocking cv2 read + model inference. Stepping it with a bare
        # `for chunk in ...` would run entirely inside this coroutine with no
        # `await` in the loop body, monopolizing the single event-loop
        # thread for the whole stream's duration (every other request would
        # stall until the stream ends). asyncio.to_thread offloads each
        # blocking frame to a worker thread and hands control back to the
        # event loop in between — other cameras' streams and endpoints like
        # /health stay responsive while this one runs.
        try:
            iterator = session.frame_generator()
        except RuntimeError as exc:
            session.release_stream()
            raise HTTPException(status_code=502, detail=str(exc))
        sentinel = object()
        try:
            while True:
                chunk = await asyncio.to_thread(next, iterator, sentinel)
                if chunk is sentinel:
                    break
                yield chunk
        finally:
            session.release_stream()

    return StreamingResponse(
        guarded_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/cameras/{camera_id}/stats")
def camera_stats(camera_id: str):
    session = require_camera(camera_id)
    return {**session.get_stats(), "confidence": session.detector.confidence_threshold}


@app.post("/cameras/{camera_id}/stop")
def stop_camera(camera_id: str):
    manager = require_camera_manager()
    session = manager.remove(camera_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    summary = session.final_summary()
    history.insert_record(
        source_type="rtsp",
        source_name=session.name,
        started_at=summary["started_at"],
        ended_at=summary["ended_at"],
        bag_count=summary["bag_count"],
        confidence_avg=summary["confidence_avg"],
        frame_count=summary["frame_count"],
        roi_used=session.detector.has_roi,
        annotated_media_path=None,
    )
    return {"stopped": True, **summary}


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
    """Browser-camera counterpart to the /cameras/* RTSP endpoints.

    A real network camera is reachable by IP from wherever the backend runs,
    so /cameras/* opens it server-side. The viewer's own device camera isn't
    — the browser can't hand a live MediaStream to a plain GET endpoint.
    Here the browser instead captures its own getUserMedia feed to a canvas,
    pushes each frame as a binary JPEG blob over this socket, and gets back
    annotated JPEG + stats as JSON — no camera is ever opened on the server.

    The client may send a text control message at any time (typically once
    before the first binary frame, but also later to live-adjust settings):
    `{"roi": [[x, y], ...]}` (normalized 0-1 points, restricts detection to
    that region) and/or `{"confidence": 0.5}` (overrides the detection
    threshold for this session). Omitting either detects the full frame at
    the deployment-wide default confidence.
    """
    det = detector
    await websocket.accept()

    if det is None:
        await websocket.close(code=1013, reason="Model is not loaded")
        return
    if not _try_acquire_browser_session():
        await websocket.close(code=1013, reason="Another live session is already active")
        return

    async with inference_lock:
        await asyncio.to_thread(det.reset_tracker)
        det.set_roi(None)
        det.set_confidence(None)

    session_start = time.time()
    frame_count = 0
    confidence_sum = 0.0
    confidence_samples = 0
    last_bag_count = 0
    roi_used = False

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            text = message.get("text")
            if text is not None:
                try:
                    control = json.loads(text)
                except json.JSONDecodeError:
                    continue
                roi = control.get("roi")
                parsed_roi = [(float(x), float(y)) for x, y in roi] if roi else None
                conf = control.get("confidence")
                async with inference_lock:
                    if "roi" in control:
                        det.set_roi(parsed_roi)
                        roi_used = parsed_roi is not None
                    if "confidence" in control:
                        det.set_confidence(float(conf) if conf is not None else None)
                continue

            data = message.get("bytes")
            if data is None:
                continue
            image_array = np.frombuffer(data, dtype=np.uint8)
            frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            start = time.perf_counter()
            async with inference_lock:
                annotated, stats = await asyncio.to_thread(det.track_frame, frame)
            elapsed_ms = (time.perf_counter() - start) * 1000

            frame_count += 1
            last_bag_count = stats["line_crossing_count"]
            if stats["current_detections"]:
                confidence_sum += stats["confidence_avg"]
                confidence_samples += 1

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
        # Not awaiting det.reset_tracker() here on purpose: release must be
        # able to complete even if this task is being cancelled (e.g. server
        # shutdown, an abrupt client disconnect racing the framework's own
        # teardown), and reset_tracker() involves an extra await that would
        # add another window for that to be interrupted. The next session's
        # connect handler already resets before it reads anything, so a
        # stale tracker between sessions is harmless. det.set_roi(None) and
        # det.set_confidence(None) are plain attribute sets, not awaited, so
        # they're safe to call here.
        det.set_roi(None)
        det.set_confidence(None)
        if frame_count > 0:
            history.insert_record(
                source_type="browser",
                source_name="Browser camera",
                started_at=session_start,
                ended_at=time.time(),
                bag_count=last_bag_count,
                confidence_avg=(confidence_sum / confidence_samples) if confidence_samples else 0.0,
                frame_count=frame_count,
                roi_used=roi_used,
                annotated_media_path=None,
            )
        _release_browser_session()


@app.get("/history")
def get_history(source_type: str | None = None, limit: int = 50, offset: int = 0):
    return history.list_records(limit=limit, offset=offset, source_type=source_type)


@app.get("/history/{record_id}")
def get_history_record(record_id: str):
    record = history.get_record(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="History record not found")
    return record


@app.delete("/history/{record_id}")
def delete_history_record(record_id: str):
    if not history.delete_record(record_id):
        raise HTTPException(status_code=404, detail="History record not found")
    return {"deleted": True}
