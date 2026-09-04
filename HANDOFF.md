# Handoff — Cement Bag Detection Prototype

Read this first. It's the single entry point for anyone picking this project
up: what it is, what changed most recently, how to run it, what was tested,
and what's explicitly not done yet.

## 1. What this is

A **prototype spike**, not a production system. It wraps a pre-trained YOLO
model ([SibgatOfficial/Cement_Bag_Detection_System](https://github.com/SibgatOfficial/Cement_Bag_Detection_System))
in a real HTTP/WebSocket API and gives it a dashboard, so the model can be
evaluated interactively instead of only via its original CLI script.

It is explicitly **out-of-band** from this workspace's main roadmap (see
[CLAUDE.md](CLAUDE.md) at the repo root) — the phased, industrial-grade
Vehicle Intelligence & Site Compliance Platform. This prototype is a fast
evaluation of one model, not Phase 6 (Material Detection) or Phase 14
(Dashboard) of that platform. Don't treat it as a drop-in component of that
system; treat it as evidence for deciding whether this model is worth
building on.

```
Conveyor Belt/
├── backend/    FastAPI service wrapping the YOLO model — see backend/README.md
└── frontend/   Next.js/TypeScript dashboard — see frontend/README.md
```

## 2. What it does

- **Image mode** — upload a still image, get back an annotated copy with bag
  count and average confidence.
- **Video mode** — upload a clip, get back an annotated copy with bags
  counted by line-crossing (not by tallying every distinct tracker ID, which
  overcounts — see `backend/app/detector.py`).
- **Live mode** — real-time detection with two camera sources:
  - **This Device** (default): uses *the viewer's own browser camera*.
    Captured client-side, streamed to the backend over a WebSocket, and
    annotated frames are streamed back — the fix described below.
  - **Network / RTSP**: points at a camera the *backend host* can reach
    (its own local webcam, or an RTSP camera/NVR). Correct tool for a real
    site camera, which is only reachable by IP from wherever the backend
    runs.

## 3. What changed in this pass

The dashboard's live mode previously only had the network-camera path, which
meant "Live" always opened a camera on whichever machine ran the backend —
not the camera on the device the person testing it was actually sitting at.
That's a real usability problem for anyone trying this dashboard on their own
laptop against a backend running elsewhere.

**Fixed** by adding a genuine browser-camera path:

- New `WS /ws/detect` backend endpoint (`backend/app/main.py`): the browser
  captures its own `getUserMedia` feed to a canvas, sends each frame as a
  binary JPEG over the socket, and gets back annotated JPEG + stats as JSON.
  No camera is ever opened on the server for this path.
- New frontend hook `frontend/src/lib/useBrowserCameraDetection.ts`: owns
  the camera permission request, the capture loop (~5 fps, with simple
  backpressure so a slow backend doesn't queue up frames), and the socket
  lifecycle.
- `ControlPanel` now has a **This Device / Network · RTSP** toggle in Live
  mode, defaulting to the viewer's own camera. The RTSP field only appears
  once "Network / RTSP" is selected.

**Also fixed, found while wiring this up** (both are real correctness/
reliability bugs, not just polish):

1. **Two live sessions could silently corrupt each other's count.** The
   detector holds one shared, non-reentrant tracker. Before this pass there
   was only ever one live path, so it didn't matter; now that a browser
   session and a network-camera session can both be started, running both at
   once would interleave frames into the same tracker state and produce a
   nonsensical bag count for both. Fixed with a simple "only one live
   session at a time" guard — a second attempt gets HTTP 409 (for
   `/stream/webcam`) or a WebSocket close with code 1013 and a reason (for
   `/ws/detect`), surfaced to the user as a toast instead of a silent wrong
   number.
2. **An active `/stream/webcam` session blocked the entire backend**,
   including `/health`. That endpoint drove its frame loop as a plain
   `for chunk in generator:` inside an async function with no `await` in the
   loop body — on a single-threaded asyncio event loop, that pins the whole
   thread processing frames for as long as the stream runs, so no other
   request (not even a health check) can be served concurrently. Confirmed
   with a real request: before the fix, `/health` didn't respond until the
   stream ended; after routing each frame through `asyncio.to_thread`, a
   health check returned in 143ms while a stream was actively running (see
   §5). This matters here specifically because the concurrency guard above
   only works if other requests can actually get through to be rejected.

## 4. Running it

Terminal 1 — backend:

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
# download best.pt from the upstream repo into backend/models/best.pt
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Click **Live → This Device → Run Detection**,
allow the camera prompt, and you should see your own camera feed annotated
in near-real-time.

**Two things every new teammate needs that are deliberately not in git**
(see `backend/.gitignore` / `frontend/.gitignore`):

- `backend/models/best.pt` — the model weights. Get them separately from the
  upstream repo linked above, or ask whoever has them.
- `frontend/.env.local` — copy `frontend/.env.local.example` and point
  `NEXT_PUBLIC_API_BASE_URL` at your backend if it's not on `localhost:8000`.

**Browser camera needs a secure context.** `getUserMedia` only works over
`https://` or on `localhost`. Testing on `localhost:3000` (the setup above)
works out of the box. If you instead serve the frontend over plain
`http://<lan-ip>:3000` to demo from a different device, the browser will
silently refuse camera permission — see backend/README.md's "Known
limitations" for what that requires (TLS in front of it).

## 5. Testing performed

No real browser/camera exists in the environment this change was built in,
so testing split into what could be verified directly vs. what needs a human
with a camera:

**Automated / verified directly:**
- `backend/app/*.py` — byte-compiled clean (`python -m py_compile`).
- `GET /health`, `POST /detect/image` — exercised via FastAPI's `TestClient`
  against the real model and weights; both return correctly-shaped
  responses.
- `WS /ws/detect` — exercised via `TestClient.websocket_connect`, sending
  synthetic JPEG frames and confirming annotated JSON responses with
  `bag_count`/`confidence_avg`/`latency_ms`/`calibrating`.
- **Concurrency guard** — confirmed a second concurrent `/ws/detect` session
  is rejected while one is active, and that a *new* session succeeds again
  once the first disconnects (this also caught and fixed the cancellation-
  safety bug described in §3 — the original `asyncio.Lock`-guarded version
  had a window where a cancelled cleanup could leave the guard permanently
  "stuck busy").
- **Cross-endpoint guard, against a real running `uvicorn` instance** (not
  just `TestClient` — see note below): started `/stream/webcam` against the
  bundled `backend/rtsp_test_server/sample.mp4`, confirmed a concurrent
  `/stream/webcam` request gets `409`, confirmed `/health` responds in
  143ms while the stream is active (previously would have blocked until the
  stream ended), and confirmed a new stream succeeds after the first ends.
- `npm run lint` and `npm run build` (Next.js/TypeScript) — both clean.

Note: the cross-endpoint test above had to run against a real `uvicorn`
process rather than `TestClient`, because `TestClient`'s synthetic transport
doesn't handle an intentionally-infinite MJPEG streaming response the way a
real ASGI server does — that's a test-harness quirk, unrelated to the actual
fix, and doesn't affect real usage (browsers consuming an `<img>` MJPEG
stream, or curl against a real server, both work as shown).

**Needs a human to verify (not possible in this environment):**
- Actual `getUserMedia` permission prompt and camera capture in a real
  browser (Chrome/Firefox/Edge) on a real device.
- Visual quality of the annotated overlay and counting-line calibration
  against a live camera feed (vs. the synthetic test frames used above).
- Behavior when camera permission is denied, or no camera is present —
  the code path is implemented (`useBrowserCameraDetection.ts` sets a
  descriptive error and toasts it) but not exercised against real browser
  permission-denial behavior.
- Multi-tab / multi-user behavior beyond the automated two-session guard
  test above (e.g. what a second person sees, not just that they're
  rejected).

**Recommended before calling this pilot-ready:** have two or three teammates
each open the dashboard on their own laptop, use Live → This Device, and
confirm they see their own camera, not each other's.

## 6. Known limitations (unchanged scope, restated for visibility)

These were already true before this pass and remain true — restated here so
the team doesn't discover them the hard way:

- Single in-process model instance, one live session at a time platform-wide.
- No auth on any endpoint, including the new WebSocket.
- No persistence, no evidence storage, no audit trail.
- Confidence threshold (`0.45` default) and ByteTrack tuning are starting
  points, not validated against real belt footage — see
  `backend/README.md`'s `CONFIDENCE_THRESHOLD` note and CLAUDE.md §28.
  "Don't invent thresholds without validation data."
- Video mode has no incremental progress UI — the whole clip processes
  before anything plays back.

Full detail lives in `backend/README.md` and `frontend/README.md`'s "Known
limitations" sections — this list is a pointer, not a replacement.

## 7. Repository note

This folder was two disconnected pieces of git history before this pass —
`frontend/` had its own repo (a single default `Create Next App` commit,
now removed) and the project root had none. It's now one repo rooted at
`Conveyor Belt/`. Nothing meaningful was lost: the removed commit was
scaffold-only, never pushed anywhere, with no other collaborators.

Not committed (see `backend/.gitignore` / `frontend/.gitignore`): Python/Node
virtualenvs and build output, `backend/models/best.pt` (get separately),
`backend/media/` (generated output), and the local RTSP test server's large
binaries (`backend/rtsp_test_server/mediamtx.exe`/`.zip` — re-download from
https://github.com/bluenviron/mediamtx/releases if you need to test RTSP
locally; the small config/cert/sample files needed to use it are kept).
