# Cement Bag Detection — standalone prototype

**New to this project? Read [HANDOFF.md](HANDOFF.md) first** — what changed
most recently, how to run it, what was tested, and what isn't done yet.

This is a **prototype spike**, explicitly out-of-band from this workspace's
main CLAUDE.md roadmap (the phased Industrial Vehicle Intelligence & Site
Compliance Platform). It exists to evaluate the YOLO model from
[SibgatOfficial/Cement_Bag_Detection_System](https://github.com/SibgatOfficial/Cement_Bag_Detection_System)
behind a real HTTP API and a dashboard, quickly — not to become the
platform's production Phase 6 (Material Detection) or Phase 14 (Dashboard)
components as-is.

```
Conveyor Belt/
├── backend/    FastAPI wrapper around the upstream YOLO model (see backend/README.md)
└── frontend/   Next.js/TypeScript dashboard (see frontend/README.md)
```

## Quick start

Terminal 1:

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
# download best.pt from the upstream repo into backend/models/best.pt
uvicorn app.main:app --reload --port 8000
```

Terminal 2:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.

## Why this isn't wired into the main platform (yet)

The upstream repo the frontend was originally asked to "connect to" turned
out to have **no HTTP API at all** — it's a CLI script (`main.py`) that reads
a local video file and writes an annotated copy, with interactive
mouse-based ROI selection. `backend/` exists because that gap had to be
filled before any frontend could talk to anything real.

Before any of this becomes part of the actual platform, per CLAUDE.md:

- Material detection is Phase 6, which comes after vehicle detection+tracking
  (Phase 4) and ANPR (Phase 5) are stable — those don't exist yet here.
- The dashboard is Phase 14, built against the unified vehicle-journey event
  schema (Phase 8) and a real Postgres/event-correlation backend (Phases
  9–13), not a single-purpose Next.js app hitting one model's API directly.
- Every compliance-relevant prediction needs model/dataset version tracking
  (Section 34) — this prototype's `/detect/image` response doesn't carry
  that yet.

See each subproject's README for prototype-specific limitations.
