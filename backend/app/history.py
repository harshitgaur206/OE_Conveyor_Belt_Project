"""Detection history: a tiny SQLite-backed log of past detections.

Uses stdlib sqlite3 rather than an ORM — one table, low write volume (one row
per image/video upload, or per camera session on stop), no need for the
abstraction. A fresh connection is opened per call: writes are infrequent
enough that this is simpler than managing a shared connection across threads.
"""

import sqlite3
import time
import uuid
from pathlib import Path

from app.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS detections (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    started_at REAL NOT NULL,
    ended_at REAL NOT NULL,
    bag_count INTEGER NOT NULL,
    confidence_avg REAL NOT NULL,
    frame_count INTEGER,
    roi_used INTEGER NOT NULL,
    annotated_media_path TEXT
)
"""


def _db_path() -> Path:
    return Path(get_settings().history_db_path)


def init_db() -> None:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute(_SCHEMA)


def insert_record(
    source_type: str,
    source_name: str,
    started_at: float,
    ended_at: float,
    bag_count: int,
    confidence_avg: float,
    frame_count: int | None,
    roi_used: bool,
    annotated_media_path: str | None,
) -> str:
    record_id = uuid.uuid4().hex
    with sqlite3.connect(_db_path()) as conn:
        conn.execute(
            """
            INSERT INTO detections
                (id, source_type, source_name, started_at, ended_at,
                 bag_count, confidence_avg, frame_count, roi_used, annotated_media_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                source_type,
                source_name,
                started_at,
                ended_at,
                bag_count,
                confidence_avg,
                frame_count,
                int(roi_used),
                annotated_media_path,
            ),
        )
    return record_id


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "source_type": row["source_type"],
        "source_name": row["source_name"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "bag_count": row["bag_count"],
        "confidence_avg": row["confidence_avg"],
        "frame_count": row["frame_count"],
        "roi_used": bool(row["roi_used"]),
        "annotated_media_path": row["annotated_media_path"],
    }


def list_records(limit: int = 50, offset: int = 0, source_type: str | None = None) -> list[dict]:
    with sqlite3.connect(_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        if source_type:
            cursor = conn.execute(
                "SELECT * FROM detections WHERE source_type = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (source_type, limit, offset),
            )
        else:
            cursor = conn.execute(
                "SELECT * FROM detections ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        return [_row_to_dict(row) for row in cursor.fetchall()]


def get_record(record_id: str) -> dict | None:
    with sqlite3.connect(_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM detections WHERE id = ?", (record_id,)).fetchone()
        return _row_to_dict(row) if row else None


def delete_record(record_id: str) -> bool:
    with sqlite3.connect(_db_path()) as conn:
        cursor = conn.execute("DELETE FROM detections WHERE id = ?", (record_id,))
        return cursor.rowcount > 0
