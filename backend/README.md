# Cement Bag Detection API (prototype)

FastAPI wrapper around the YOLO model from
[SibgatOfficial/Cement_Bag_Detection_System](https://github.com/SibgatOfficial/Cement_Bag_Detection_System).
That repo is a CLI script with no HTTP API — this service exposes its model
over `/health`, `/detect/image`, `/detect/video`, and `/stream/webcam` so the
`frontend/` dashboard has something to talk to.

**Status: prototype spike**, not the production Phase 6 Material Detection
service described in the platform's CLAUDE.md. See the header comment in
`app/main.py` for what changes before production.

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

Download `best.pt` from the upstream repo and place it at `backend/models/best.pt`
(or point `MODEL_PATH` at wherever you keep it).

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for interactive API docs.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `MODEL_PATH` | `models/best.pt` | Path to the YOLO weights |
| `CONFIDENCE_THRESHOLD` | `0.45` | Upstream's own default (`0.10`) is tuned for their specific footage and is very permissive — on anything outside that training distribution (a person, a random room) it readily produces spurious detections, since this is a narrow custom-trained bag detector, not a general classifier. `0.45` is a more conservative starting point for general use; re-tune against your own validated footage (don't just trust either number blindly — CLAUDE.md Section 28) |
| `IOU_THRESHOLD` | `0.45` | NMS IOU threshold |
| `IMAGE_SIZE` | `640` | Inference image size |
| `WEBCAM_INDEX` | `0` | `cv2.VideoCapture` device index on the backend host |
| `WEBCAM_FRAME_SKIP` | `1` | Run inference every Nth frame (raise this if the stream lags) |
| `MEDIA_DIR` | `media` | Where annotated output videos are written |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `DEVICE` | `auto` | `auto` picks CUDA if available else CPU; or force `cpu` / `cuda:0` |
| `TRACKER_CONFIG_PATH` | `backend/bytetrack.yaml` | ByteTrack tuning — this is the **upstream repo's own tuned config** (longer track buffer, looser match threshold), not ultralytics' generic default |
| `COUNTING_LINE_ORIENTATION` | `auto` | `auto` calibrates the counting line to whatever direction bags actually move in frame (see below); `horizontal`/`vertical` fix it immediately for a known camera setup |
| `COUNTING_LINE_FRACTION` | `0.5` | Line position as a fraction of frame height/width — only used by explicit `horizontal`/`vertical` orientation; `auto` always uses the frame center |
| `CALIBRATION_MIN_SAMPLES` | `20` | Track-position observations collected before `auto` locks in a travel direction |
| `MIN_HIT_STREAK` | `3` | Frames a track must persist before it's eligible to be counted, to filter noise |

### Why counting is orientation-agnostic

Bag counting is **not tied to this one demo video's geometry**. `app/line_counter.py`'s
`auto` mode (the default) doesn't assume the belt moves in any particular
direction, or that it occupies any particular part of the frame: for the
first `CALIBRATION_MIN_SAMPLES` frame-to-frame track movements it observes,
it accumulates both the net displacement vector (for direction) and the
centroid of observed bag positions (for where to anchor the line) — not the
frame's geometric center. That distinction matters for a camera whose view
is wider than the belt itself (e.g. an overhead shot covering the loading
bay plus the belt in one corner): anchoring at the frame center would put
the line somewhere bags never actually pass through, silently stuck at
count 0 forever. Anchoring at the observed centroid instead puts it right
on the belt, wherever that happens to be in frame. A belt moving
top-to-bottom, left-to-right, or at a diagonal, anywhere in frame, all work
the same way, on any camera placement, with zero per-site tuning. While
calibrating, the video overlay shows "Calibrating counting line..." instead
of a count; this takes a fraction of a second once bags start moving through
frame. If you already know a fixed installation's belt direction and want
counting active from frame 1, set `COUNTING_LINE_ORIENTATION=horizontal` or
`vertical` explicitly instead.

### Running on a GPU

By default `pip install -r requirements.txt` gets you CPU-only torch. If you
have an NVIDIA GPU, install the CUDA build instead (check your driver's max
supported CUDA version with `nvidia-smi`, then pick a matching `cuXXX` tag):

```bash
pip install --force-reinstall torch==2.14.0+cu130 torchvision --index-url https://download.pytorch.org/whl/cu130
```

`--force-reinstall` matters here: `pip install torch==2.14.0` alone will
report "already satisfied" against an existing `2.14.0+cpu` install, since
pip matches on the public version and ignores the `+cpu`/`+cuXXX` local tag.
`DEVICE=auto` (the default) then picks up CUDA automatically at startup —
check the `GET /health` log line or `torch.cuda.is_available()` to confirm.

### RTSP cameras

`cv2.VideoCapture` accepts an RTSP URL directly through its bundled FFmpeg
backend, so `LiveStreamManager` (`app/streaming.py`) uses the exact same code
path for a local webcam and an RTSP feed — only the source string differs.
Test connectivity first with the lightweight probe (no annotated stream, no
tracker reset):

```bash
curl "http://localhost:8000/stream/check?source=rtsp://your-camera-url"
```

A working camera returns `"opened": true, "frame_read": true` plus its real
resolution/fps. If `opened` is `false`, it's a network/URL/credentials
problem before OpenCV even gets a frame; if `opened` is `true` but
`frame_read` is `false`, the connection succeeded but the stream's codec or
transport likely isn't something this FFmpeg build supports. Once confirmed,
point the live view at it: `GET /stream/webcam?rtsp_url=rtsp://your-camera-url`.

**"opened: false" with a cloud provider (Wowza, etc.) — check ingest vs.
playback URLs.** `/stream/check` also logs the underlying FFmpeg RTSP
exchange (set `OPENCV_LOG_LEVEL=DEBUG` to see it on stdout). If the log shows
a `DESCRIBE` succeeding (you get real SDP back — codec, resolution, fps) but
`SETUP failed: 403 Forbidden`, the stream is live and reachable, but the
*server itself* refused playback — almost always because the URL you have is
an **ingest/entrypoint** address (where a camera/encoder pushes video *in*),
not a dedicated **playback** URL. Cloud RTSP providers keep these separate;
check the provider's dashboard for the stream's playback URL specifically.

This is TCP/UDP RTSP via OpenCV's FFmpeg backend, not GStreamer/DeepStream —
fine for a prototype single-camera view, but CLAUDE.md's target architecture
(Section 3) is DeepStream/GStreamer with hardware decode for the real
multi-camera platform; revisit this before production.

## Endpoints

- `GET /health` — `{status, model_loaded, model_path}`
- `POST /detect/image` (multipart file) — `{annotated_image_base64, bag_count, latency, confidence_avg}`
- `POST /detect/video` (multipart file) — processes the whole clip, returns `{annotated_video_url, bag_count, frame_count, latency, confidence_avg}`; fetch the video from `GET /media/{filename}`
- `WS /ws/detect` — **browser-camera live detection.** The browser captures its own `getUserMedia` feed to a canvas, sends each frame as a binary JPEG blob over this socket, and receives back `{annotated_image_base64, bag_count, confidence_avg, latency_ms, calibrating}` as JSON. No camera is opened on the server — this is the "use my own device's camera" path. See `frontend/src/lib/useBrowserCameraDetection.ts` for the client side.
- `GET /stream/webcam` — MJPEG stream (`multipart/x-mixed-replace`) of a camera reachable from **the backend host** — its own local webcam by default, or an RTSP camera/NVR when `?rtsp_url=` is passed. Point an `<img>` tag at it. This is the right tool for a real network camera; it is **not** the viewer's own device camera (use `/ws/detect` for that).
- `GET /stream/webcam/stats` — poll for `{active, bag_count, confidence_avg, fps, updated_at}` while the stream runs
- `POST /stream/webcam/stop` — releases the camera
- `GET /stream/check?source=<rtsp_url_or_device_index>` — diagnostic: opens the source and tries to read one frame *without* starting a persistent stream. Returns `{source, opened, frame_read, width, height, fps, elapsed_ms}`. Use this to verify an RTSP URL is reachable before pointing the dashboard at it.

Only one live session — `/ws/detect` or `/stream/webcam` — can run at a time; a second concurrent attempt gets `409`/close-code `1013`. This is enforced because both paths share one in-process model+tracker instance (see "Known limitations" below), so two interleaved live sessions would silently corrupt each other's bag count.

## Known limitations (prototype)

- Single in-process model instance guarded by one lock, with only one live session (browser or network camera) allowed at a time — fine for a demo, not for concurrent multi-camera load. Two people cannot run live detection simultaneously against one backend instance.
- `/ws/detect` has no auth or per-origin check — anyone who can reach the backend's WebSocket port can push frames to it. Fine on a private/local network for a demo; add auth before exposing this beyond that.
- Browser camera access (`getUserMedia`) requires a secure context — `https://` or `localhost`. If the frontend is served over plain `http://` from another machine's IP (a common way to demo across a LAN), browsers will block camera permission entirely; put a reverse proxy with TLS in front, or demo from `localhost` on the machine with the camera.
- Bag counting uses an auto-calibrated straight counting line (see "Why counting is orientation-agnostic" above), not the original repo's interactive mouse-selected polygon ROI+line (there's no terminal to click in on a server). It generalizes across belt direction/camera angle, but it's still a single straight line, not an arbitrary polygon — a belt with multiple lanes crossing frame at very different angles simultaneously isn't handled.
- No auth, no persistence, no evidence storage — matches CLAUDE.md's Section 35 "Prototype" tier only.
