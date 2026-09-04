# Cement Bag Detection Hub (frontend prototype)

Single-page dashboard for the `backend/` FastAPI service. Not the platform's
production Phase 14 dashboard (see the root README) — a standalone spike.

## Setup

```bash
npm install
cp .env.local.example .env.local   # point NEXT_PUBLIC_API_BASE_URL at your backend if not localhost:8000
npm run dev
```

Open http://localhost:3000. The header polls `GET /health` every 15s and
shows connected/disconnected; a red toast fires when the backend first goes
unreachable.

## Structure

```
src/
├── app/
│   ├── layout.tsx      # root layout, dark theme, sonner Toaster
│   └── page.tsx         # Dashboard: wires header/control panel/viewer/stats together
├── components/
│   ├── Header.tsx
│   ├── ControlPanel.tsx # mode toggle, live-source toggle, upload zone, run/stop button
│   ├── UploadZone.tsx   # drag-and-drop file input
│   ├── Viewer.tsx        # image / video / live feed display + loading state
│   ├── StatsPanel.tsx    # bag count / latency / avg confidence tiles
│   └── ui/               # button.tsx, card.tsx primitives
├── lib/
│   ├── api.ts                        # fetch wrappers for every backend endpoint
│   └── useBrowserCameraDetection.ts  # getUserMedia capture -> WebSocket -> annotated frame
└── types/detection.ts     # shared request/response types
```

## Notes

- **Live mode has two camera sources**, chosen with the toggle above the
  RTSP field:
  - **This Device** (default) — captures *your own* browser's camera via
    `getUserMedia`, sends frames to the backend over `WS /ws/detect`, and
    renders the annotated result back. Nothing is opened on the backend
    machine. Requires camera permission and a secure context (`https://` or
    `localhost` — plain `http://` from another machine's IP will silently
    fail to get permission; see backend/README.md).
  - **Network / RTSP** — points an `<img>` at the backend's MJPEG endpoint
    (`GET /stream/webcam`), which opens a camera **reachable from the
    backend host**: its own local webcam, or an RTSP camera/NVR when a URL
    is given. Correct for a real site camera (only the backend can reach
    it by IP); not the viewer's own device.

  Only one of these can be live at a time backend-wide (see backend/README.md)
  — starting one while the other is already running elsewhere gets rejected
  with a toast, not a silent wrong count.
- Video mode uploads the whole clip, waits for the backend to process every
  frame, then plays back the annotated result — there is no incremental
  progress UI yet.
