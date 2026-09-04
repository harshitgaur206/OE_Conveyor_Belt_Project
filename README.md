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
